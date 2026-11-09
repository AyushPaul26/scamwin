"""Original cloud bat, crystal beetle, and dusk rabbit source geometry.

Run with the pinned Blender 4.5.9 executable. These are separate authored
anatomies sharing the approved collection's material and animation contract.
"""
import argparse
import math
from pathlib import Path
import sys

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))
from creature_builder import CreatureBuilder, Quaternion, Vector


def ellipsoid_surface(center, radii, offset=0.008):
    def surface(x, z):
        nx, nz = (x - center[0]) / radii[0], (z - center[2]) / radii[2]
        return center[1] - radii[1] * math.sqrt(max(0.025, 1 - nx * nx - nz * nz)) - offset
    return surface


def smile(b, cy, cz, width=0.18, bone="head"):
    points = [(-width, cy + 0.025, cz + 0.045), (-width * 0.5, cy, cz),
              (0, cy - 0.005, cz - 0.012), (width * 0.5, cy, cz),
              (width, cy + 0.025, cz + 0.045)]
    points, widths = b.smooth_path(points, [0.005, 0.011, 0.012, 0.011, 0.005], 3)
    b.tube("Gentle smile", points, widths, "nose", bone, 8)


def base_rig(head, eyes, extras):
    return {
        "root": ((0, 0, 0.10), (0, 0, 0.70), None),
        "head": (head, (head[0], head[1], head[2] + 0.5), "root"),
        "eye_L": (eyes[0], (eyes[0][0], eyes[0][1], eyes[0][2] + 0.2), "head"),
        "eye_R": (eyes[1], (eyes[1][0], eyes[1][1], eyes[1][2] + 0.2), "head"),
        **extras,
    }


def breathing(b, extras, floating=False):
    for frame in (1, 31, 61, 91, 121):
        phase = (frame - 1) / 120 * math.tau
        breath = 0.5 - 0.5 * math.cos(phase)
        b.key("root", frame, scale=(1 + .012 * breath, 1 + .012 * breath, 1 + .008 * breath),
              location=(0, .035 * breath if floating else 0, 0))
        for name, axis, amplitude, delay in extras:
            b.key(name, frame, rotation=b.world_rotation(name, Quaternion(axis, amplitude * math.sin(phase + delay))))
    b.finish_action("idle", 121)


def wing(b, side):
    """A closed, softly domed scalloped membrane with curved leading bones."""
    s = -1 if side == "L" else 1
    outline = [(.36, 1.56), (.52, 1.96), (.95, 2.12), (1.45, 2.27),
               (1.62, 2.24), (1.46, 1.90), (1.35, 1.60),
               (1.18, 1.73), (1.05, 1.42), (.87, 1.53),
               (.70, 1.23), (.54, 1.40)]
    center = Vector((.75, .09, 1.75))
    vertices, faces = [], []
    rows = 7
    count = len(outline)
    # Rounded outline interpolation retains deliberate concave finger scallops.
    boundary = []
    for i, current in enumerate(outline):
        p0, p1 = Vector(outline[(i - 1) % count]), Vector(current)
        p2, p3 = Vector(outline[(i + 1) % count]), Vector(outline[(i + 2) % count])
        for step in range(4):
            t = step / 4
            point = .5 * ((2*p1) + (-p0+p2)*t + (2*p0-5*p1+4*p2-p3)*t*t + (-p0+3*p1-3*p2+p3)*t*t*t)
            boundary.append(point)
    count = len(boundary)
    for layer in (-1, 1):
        for ring in range(rows + 1):
            r = ring / rows
            for edge in boundary:
                x = center.x + (edge.x - center.x) * r
                z = center.z + (edge.y - center.z) * r
                y = .10 + .04 * (x - .7) + layer * (.012 + .045 * (1-r*r))
                vertices.append((s*x, y, z))
    layer_size = count * (rows + 1)
    for layer in range(2):
        for ring in range(rows):
            for col in range(count):
                a = layer * layer_size + ring * count + col
                q = (a, layer * layer_size + ring * count + (col+1)%count,
                     layer * layer_size + (ring+1)*count+(col+1)%count, a+count)
                faces.append(q if layer else tuple(reversed(q)))
    for col in range(count):
        a, n = rows*count+col, rows*count+(col+1)%count
        faces.append((a, n, n+layer_size, a+layer_size))
    b.mesh(f"Scalloped wing {side}", vertices, faces, "accent", f"wing_{side}")
    leading = [(s*x, .045, z) for x, z in [(.34, 1.60), (.50, 1.94), (.94, 2.12), (1.44, 2.26), (1.60, 2.24)]]
    pts, widths = b.smooth_path(leading, [.10, .085, .058, .035, .006], 3)
    b.tube(f"Wing leading edge {side}", pts, widths, "body", f"wing_{side}", 14)
    for digit, endpoint in enumerate([(1.35, 1.60), (1.05, 1.42), (.70, 1.23)]):
        pts = [(s*.51, .035, 1.93), (s*(.62+endpoint[0]*.35), .025, 1.77), (s*endpoint[0], .07, endpoint[1])]
        pts, widths = b.smooth_path(pts, [.035, .025, .006], 4)
        b.tube(f"Wing finger {side} {digit}", pts, widths, "body", f"wing_{side}", 10)
    b.rounded(f"Wing thumb {side}", (s*.53, -.01, 2.04), (.07, .06, .12), "cream", f"wing_{side}", 20, 12)


def cloud_bat():
    b = CreatureBuilder("cloud-bat", {"body":"8a82b3", "cream":"f0e9e2", "accent":"bd98c6"})
    b.rounded("Pear-shaped flying body", (0, .06, 1.12), (.47, .35, .66), "body", segments=36, rings=22,
              deform=lambda x,y,z:(x*(1-.12*z), y*(1-.08*z), z))
    body_surface = ellipsoid_surface((0,.06,1.12),(.49,.35,.66))
    b.patch("Fluffy chest bib",0,1.24,.35,.49,"cream",body_surface,"root",rings=12,segments=36,
            shape=lambda x,z:(x*(1+.08*math.cos(math.atan2(z,x)*8)), z))
    for side, s in (("L",-1),("R",1)):
        for n in range(3):
            b.leaf(f"Chest down {side} {n}",(s*(.08+n*.07),-.29,1.12),(s*(.13+n*.11),-.26,.86+n*.05),.075,.04,"cream","root",0)
    b.rounded("Wide bat head",(0,-.025,2.03),(.63,.43,.49),"body","head",36,24,
              deform=lambda x,y,z:(x*(1+.07*-z),y,z))
    head_surface = ellipsoid_surface((0,-.025,2.03),(.66,.43,.49))
    b.patch("Soft face mask",0,1.92,.50,.30,"cream",head_surface,"head",rings=12,segments=36)
    eyes = ((-.275,-.418,2.12),(.275,-.418,2.12))
    b.eyes(*eyes,radii=(.18,.062,.23),surface=head_surface)
    b.rounded("Bat button nose",(0,-.488,1.96),(.093,.043,.065),"nose","head",24,14,
              deform=lambda x,y,z:(x*(.85+.22*z),y,z))
    smile(b,-.469,1.84,.13)
    for side, s in (("L",-1),("R",1)):
        b.leaf(f"Tall ear cup {side}",(s*.32,.015,2.32),(s*.66,.04,3.37),.245,.115,"body",f"ear_{side}",-.02)
        b.leaf(f"Velvet ear inset {side}",(s*.35,-.092,2.47),(s*.64,-.045,3.25),.145,.018,"accent",f"ear_{side}",-.015)
        b.rounded(f"Little foot {side}",(s*.235,-.015,.50),(.15,.22,.15),"body",f"foot_{side}",24,14)
        for toe in (-1,1):
            b.rounded(f"Foot claw {side} {toe}",(s*.235+toe*.05,-.205,.51),(.035,.075,.035),"cream",f"foot_{side}",12,8)
        wing(b,side)
    bones = base_rig((0,0,1.60),eyes,{
        "wing_L":((-.34,.08,1.62),(-.95,.08,1.92),"root"),
        "wing_R":((.34,.08,1.62),(.95,.08,1.92),"root"),
        "ear_L":((-.33,0,2.37),(-.56,.03,3.0),"head"),
        "ear_R":((.33,0,2.37),(.56,.03,3.0),"head"),
        "foot_L":((-.235,0,.63),(-.235,-.12,.45),"root"),
        "foot_R":((.235,0,.63),(.235,-.12,.45),"root"),
    })
    b.make_rig(bones)
    breathing(b,[("wing_L",(0,1,0),.035,0),("wing_R",(0,1,0),-.035,0),
                 ("ear_L",(0,1,0),.025,0),("ear_R",(0,1,0),-.03,.6)],floating=True)
    for frame in (1,10,18,26,34,42,50,58,70):
        t=(frame-1)/69
        envelope=math.sin(math.pi*t)
        flutter=.30*math.sin(t*math.tau*3)*envelope
        b.key("wing_L",frame,rotation=b.world_rotation("wing_L",Quaternion((0,1,0),flutter)))
        b.key("wing_R",frame,rotation=b.world_rotation("wing_R",Quaternion((0,1,0),-flutter)))
        b.key("root",frame,location=(0,.13*envelope,0))
        b.key("ear_L",frame,rotation=b.world_rotation("ear_L",Quaternion((0,1,0),-.08*envelope)))
        b.key("ear_R",frame,rotation=b.world_rotation("ear_R",Quaternion((0,1,0),.08*envelope)))
    b.finish_action("greet",70)
    return b


def crystal_horn(b):
    """Low-poly crystal facets contrast with the rounded beetle shell."""
    rings=[((0,-.25,1.89),.17),((0,-.28,2.12),.20),((0,-.33,2.47),.13),((0,-.42,2.77),0)]
    vertices=[]
    sides=7
    for center,radius in rings:
        for i in range(sides):
            a=i/sides*math.tau
            vertices.append((center[0]+math.cos(a)*radius,center[1]+math.sin(a)*radius,center[2]))
    faces=[]
    for ring in range(len(rings)-1):
        for i in range(sides):
            a=ring*sides+i
            faces.append((a,ring*sides+(i+1)%sides,(ring+1)*sides+(i+1)%sides,a+sides))
    faces.append(tuple(range(sides-1,-1,-1)))
    obj=b.mesh("Prismatic crown horn",vertices,faces,"accent","head")
    for polygon in obj.data.polygons:
        polygon.use_smooth=False


def crystal_beetle():
    b=CreatureBuilder("crystal-beetle",{"body":"548f9c","cream":"d8e8d6","accent":"91d4cb"})
    shell=b.materials["body"].node_tree.nodes["Principled BSDF"]
    shell.inputs["Metallic"].default_value=.28
    shell.inputs["Roughness"].default_value=.29
    shell.inputs["Coat Weight"].default_value=.32
    horn=b.materials["accent"].node_tree.nodes["Principled BSDF"]
    horn.inputs["Transmission Weight"].default_value=.32
    horn.inputs["Roughness"].default_value=.17
    horn.inputs["Coat Weight"].default_value=.35
    horn.inputs["IOR"].default_value=1.38
    b.rounded("Broad domed shell",(0,.23,1.30),(.83,.61,1.0),"body",segments=40,rings=26,
              deform=lambda x,y,z:(x*(1-.12*z),y*(1+.07*z),z))
    b.rounded("Lower abdomen",(0,-.06,.64),(.61,.44,.46),"cream",segments=32,rings=18)
    # Curved case seam and wing-case contours are inset dark sculpted seams.
    b.tube("Shell central seam",[(0,-.145,2.20),(0,-.31,2.00),(0,-.375,1.81)], [.016,.018,.008],"nose","root",8)
    for side,s in (("L",-1),("R",1)):
        pts=[(s*.12,-.13,2.18),(s*.46,-.245,1.98),(s*.66,-.22,1.67),(s*.74,-.10,1.35),(s*.67,-.09,.94)]
        pts,r=b.smooth_path(pts,[.012,.018,.018,.014,.003],3)
        b.tube(f"Shell shoulder trim {side}",pts,r,"cream","root",10)
    b.rounded("Curious beetle face",(0,-.40,1.32),(.61,.40,.48),"body","head",36,24,
              deform=lambda x,y,z:(x*(1+.05*-z),y,z))
    head_surface=ellipsoid_surface((0,-.40,1.32),(.64,.40,.48))
    b.patch("Cream chin",0,1.11,.43,.23,"cream",head_surface,"head",rings=10,segments=36)
    eyes= ((-.26,-.756,1.43),(.26,-.756,1.43))
    b.eyes(*eyes,radii=(.17,.063,.22),surface=head_surface)
    b.rounded("Tiny nose",(0,-.815,1.20),(.06,.023,.041),"nose","head",18,12)
    smile(b,-.792,1.075,.16)
    crystal_horn(b)
    extras={}
    for side,s in (("L",-1),("R",1)):
        for number,(x,y,z) in enumerate([(.49,-.12,.63),(.62,.18,.66),(.57,.47,.67)]):
            name=f"leg_{side}_{number}"
            bend=(s*(x+.23),y-.02,.40)
            toe=(s*(x+.31),y-.10,.22)
            pts=[(s*x,y,z),bend,toe]
            pts,r=b.smooth_path(pts,[.105,.10,.075],4)
            b.tube(f"Little leg {side} {number}",pts,r,"body",name,14)
            b.rounded(f"Soft foot {side} {number}",(toe[0],toe[1]-.06,.19),(.15,.18,.12),"body",name,20,12)
            extras[name]=((s*x,y,z),toe,"root")
        pts=[(s*.35,-.39,1.72),(s*.51,-.38,1.99),(s*.64,-.37,2.05)]
        pts,r=b.smooth_path(pts,[.028,.022,.012],4)
        b.tube(f"Antenna {side}",pts,r,"body","head",10)
        b.rounded(f"Antenna jewel {side}",(s*.64,-.37,2.05),(.07,.055,.07),"accent","head",20,12)
    b.make_rig(base_rig((0,0,.95),eyes,extras))
    breathing(b,[("leg_L_0",(0,0,1),.025,0),("leg_R_0",(0,0,1),-.025,0)])
    for frame,angle,bounce in [(1,0,0),(12,.08,0),(28,.36,-.045),(40,.36,-.045),(56,.12,-.01),(76,0,0)]:
        b.key("root",frame,rotation=b.world_rotation("root",Quaternion((1,0,0),angle)),location=(0,bounce,0))
        for side,s in (("L",-1),("R",1)):
            for number in range(3):
                name=f"leg_{side}_{number}"
                b.key(name,frame,rotation=b.world_rotation(name,Quaternion((0,1,0),s*angle*.20)))
    b.finish_action("greet",76)
    return b


def rabbit_ear(b,side):
    s=-1 if side=="L" else 1
    if side=="L":
        points=[(-.28,.01,2.20),(-.36,.025,2.58),(-.43,.04,3.01),(-.40,.055,3.29),(-.34,.06,3.37)]
        radii=[(.12,.075),(.17,.10),(.17,.085),(.11,.06),(.005,.003)]
    else:
        points=[(.28,.01,2.20),(.42,.01,2.54),(.60,-.01,2.87),(.80,-.03,2.99),(.93,-.05,2.92),(.95,-.07,2.77)]
        radii=[(.12,.075),(.17,.10),(.18,.085),(.145,.07),(.09,.055),(.005,.003)]
    # Dense hand-shaped cross sections make the fold flow continuously.
    p=[]; widths=[]
    for j in range(len(points)-1):
        a=Vector(points[max(j-1,0)]);c=Vector(points[j]);d=Vector(points[j+1]);e=Vector(points[min(j+2,len(points)-1)])
        for step in range(4):
            t=step/4
            p.append(tuple(.5*((2*c)+(-a+d)*t+(2*a-5*c+4*d-e)*t*t+(-a+3*c-3*d+e)*t*t*t)))
            widths.append(tuple(radii[j][k]*(1-t)+radii[j+1][k]*t for k in range(2)))
    p.append(points[-1]);widths.append(radii[-1])
    b.tube(f"Long asymmetric ear {side}",p,widths,"body",f"ear_{side}",24)
    inset=[(x,y-.085,z) for x,y,z in p]
    b.tube(f"Warm ear velvet {side}",inset,[(w*.58,.014) for w,h in widths],"accent",f"ear_{side}",18)


def dusk_rabbit():
    b=CreatureBuilder("dusk-rabbit",{"body":"b18eab","cream":"f4e2ce","accent":"d2a4b4"})
    b.rounded("Compact rabbit body",(0,.06,.94),(.48,.35,.64),"body",segments=36,rings=22,
              deform=lambda x,y,z:(x*(1-.14*z),y*(1-.10*z),z))
    def tummy_surface(x, z):
        nz = (z - .94) / .64
        nx = x / (.48 * (1 - .14 * nz))
        return .06 - .35 * (1 - .10 * nz) * math.sqrt(max(.025, 1 - nx * nx - nz * nz)) - .012
    b.patch("Cream tummy",0,.86,.29,.42,"cream",tummy_surface,"root",rings=10,segments=36)
    b.rounded("Soft rabbit head",(0,-.025,1.86),(.62,.47,.53),"body","head",36,24,
              deform=lambda x,y,z:(x*(1+.09*math.exp(-((z+.4)/.4)**2)),y,z))
    head_surface=ellipsoid_surface((0,-.025,1.86),(.66,.47,.53))
    b.patch("Cheek cream",0,1.70,.49,.29,"cream",head_surface,"head",rings=12,segments=36)
    eyes= ((-.26,-.452,1.95),(.26,-.452,1.95))
    b.eyes(*eyes,radii=(.18,.066,.235),surface=head_surface)
    b.rounded("Little rabbit muzzle",(0,-.48,1.63),(.27,.10,.13),"cream","head",28,16,
              deform=lambda x,y,z:(x,y,z*(1-.10*math.exp(-(x/.25)**2))))
    b.rounded("Heart-shaped nose",(0,-.586,1.70),(.075,.027,.052),"nose","head",20,12,
              deform=lambda x,y,z:(x*(.85+.25*z),y,z))
    b.tube("Rabbit philtrum",[(0,-.594,1.68),(0,-.597,1.63)],[.009,.008],"nose","head",8)
    smile(b,-.587,1.59,.12)
    for side,s in (("L",-1),("R",1)):
        for n in range(2):
            b.leaf(f"Cheek tuft {side} {n}",(s*.40,-.18,1.69-n*.10),(s*(.76-n*.035),-.14,1.73-n*.20),.105,.062,"cream","head",-.015)
        rabbit_ear(b,side)
        pts=[(s*.32,.02,1.22),(s*.50,-.075,1.10),(s*.56,-.17,.89),(s*.53,-.21,.83)]
        pts,r=b.smooth_path(pts,[.06,.135,.13,.008],4)
        b.tube(f"Small front paw {side}",pts,r,"body",f"arm_{side}",18)
        b.rounded(f"Paw velvet {side}",(s*.555,-.272,.925),(.064,.015,.07),"accent",f"arm_{side}",18,10)
        b.rounded(f"Long hind paw {side}",(s*.26,-.13,.22),(.23,.34,.16),"body",f"foot_{side}",28,16)
        for toe in (-1,0,1):
            b.tube(f"Toe crease {side} {toe}",[(s*.26+toe*.07,-.423,.245),(s*.26+toe*.07,-.441,.21)],[.006,.003],"cream",f"foot_{side}",6)
    b.rounded("Cotton tail",(.39,.32,.68),(.24,.22,.24),"cream","tail",28,18,
              deform=lambda x,y,z:(x*(1+.05*math.cos(math.atan2(y,x)*6)),y,z))
    extras={
        "arm_L":((-.36,0,1.19),(-.53,-.17,.88),"root"),
        "arm_R":((.36,0,1.19),(.53,-.17,.88),"root"),
        "foot_L":((-.26,0,.25),(-.26,-.23,.21),"root"),
        "foot_R":((.26,0,.25),(.26,-.23,.21),"root"),
        "ear_L":((-.28,.01,2.20),(-.41,.03,2.90),"head"),
        "ear_R":((.28,.01,2.20),(.61,-.01,2.85),"head"),
        "tail":((.30,.25,.60),(.45,.38,.77),"root"),
    }
    b.make_rig(base_rig((0,0,1.45),eyes,extras))
    breathing(b,[("ear_L",(0,1,0),.035,0),("ear_R",(0,1,0),-.035,.8),
                 ("arm_L",(0,1,0),.016,0),("arm_R",(0,1,0),-.016,0),("tail",(0,1,0),.045,.3)])
    for frame,lift,wave,perk in [(1,0,0,0),(12,.4,0,.14),(24,1.75,-.16,.20),(32,1.75,.18,.20),
                                 (40,1.75,-.16,.17),(48,1.75,.18,.13),(60,.70,0,.08),(76,0,0,0)]:
        world=Quaternion((0,1,0),-lift+wave) @ Quaternion((1,0,0),.25*min(lift,1))
        b.key("arm_R",frame,rotation=b.world_rotation("arm_R",world))
        b.key("ear_L",frame,rotation=b.world_rotation("ear_L",Quaternion((0,1,0),-perk)))
        b.key("ear_R",frame,rotation=b.world_rotation("ear_R",Quaternion((0,1,0),perk)))
        b.key("root",frame,location=(0,.035*min(lift,1),0))
        b.key("tail",frame,rotation=(.04*min(lift,1),0,0))
    b.finish_action("greet",76)
    return b


BUILDERS={"cloud-bat":cloud_bat,"crystal-beetle":crystal_beetle,"dusk-rabbit":dusk_rabbit}

if __name__=="__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("--species",choices=tuple(BUILDERS),default=None)
    parser.add_argument("--render",action="store_true")
    parser.add_argument("--pose",choices=("neutral","greet","blink"),default="neutral")
    args=parser.parse_args(sys.argv[sys.argv.index("--")+1:] if "--" in sys.argv else [])
    for name in ([args.species] if args.species else BUILDERS):
        builder=BUILDERS[name]()
        builder.export(render=args.render,render_pose=args.pose)
