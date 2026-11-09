"""Author the original ember gecko, tide axolotl, and spark jerboa in Blender 4.5.9."""
import argparse
import math
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from creature_builder import CreatureBuilder, Quaternion


def eye_bones(centers):
    return {f"eye_{side}": (p, (p[0], p[1], p[2] + .18), "head")
            for side, p in zip(("L", "R"), centers)}


def gecko():
    b = CreatureBuilder("ember-gecko", {"body": "c97243", "cream": "ffd78a", "accent": "d94937"})
    # The long-toed limbs, horizontal snout, fan crest and curled tail make a
    # reptile silhouette independent of the woodland mammal design.
    b.rounded("Pear abdomen", (0, .035, .86), (.45, .34, .70), "body", segments=40, rings=24,
        deform=lambda x,y,z: (x*(1-.19*z), y-.08*z, z))
    body_surface = lambda x,z: .035-.34*math.sqrt(max(.01,1-(x/(.45*(1-.19*(z-.86)/.70)))**2-((z-.86)/.70)**2))-.03
    b.patch("Amber belly", 0, .83, .29, .49, "cream", body_surface, "root", rings=10, segments=36)
    b.rounded("Wide reptile head", (0,-.025,1.80), (.73,.47,.44), "body", "head", 44, 26,
        deform=lambda x,y,z: (x*(1+.07*-z), y*(1+.08*-z), z))
    head_surface=lambda x,z: -.025-.47*(1+.08*-(z-1.8)/.44)*math.sqrt(max(.015,1-(x/(.73*(1+.07*-(z-1.8)/.44)))**2-((z-1.8)/.44)**2))-.008
    b.patch("Lower snout", 0,1.58,.56,.15,"cream",head_surface,"head",rings=8,segments=40,
        shape=lambda x,z:(x,z+.12*x*x))
    centers=((-0.395,-.405,1.88),(.395,-.405,1.88))
    b.eyes(*centers,radii=(.175,.075,.215),surface=head_surface)
    for sign,side in ((-1,"L"),(1,"R")):
        b.rounded(f"Nostril {side}",(sign*.16,-.492,1.75),(.018,.009,.012),"nose","head",12,8)
        b.tube(f"Smile {side}",[(0,-.492,1.61),(sign*.15,-.485,1.605),(sign*.30,-.455,1.64),(sign*.38,-.415,1.69)], [.007,.011,.009,.003],"nose","head",8)
        # Small cream eyebrow ridges join the head rather than floating above it.
        b.tube(f"Eye ridge {side}",[(sign*.23,-.345,2.055),(sign*.37,-.30,2.12),(sign*.50,-.22,2.10)], [.012,.026,.008],"body","head",10)
        points=[(sign*.29,.015,1.22),(sign*.44,-.01,1.18),(sign*.55,-.10,1.00),(sign*.64,-.16,.92)]
        p,r=b.smooth_path(points,[.06,.115,.10,.07],3)
        b.tube(f"Forearm {side}",p,r,"body",f"arm_{side}",16)
        for i in (-1,0,1):
            x=sign*.64+i*.058
            b.tube(f"Finger {side} {i}",[(x,-.17,.94),(x+i*.015,-.225,.88),(x+i*.027,-.25,.85)], [.043,.027,.018],"body",f"arm_{side}",10)
            b.rounded(f"Finger pad {side} {i}",(x+i*.027,-.25,.85),(.032,.034,.023),"cream",f"arm_{side}",12,8)
        b.rounded(f"Haunch {side}",(sign*.34,.04,.40),(.23,.25,.28),"body","root",24,16)
        b.rounded(f"Hind foot {side}",(sign*.32,-.12,.13),(.20,.25,.12),"body",f"foot_{side}",24,14)
        for i in (-1,0,1):
            x=sign*.32+i*.095
            b.tube(f"Toe {side} {i}",[(x,-.23,.16),(x+i*.045,-.37,.12),(x+i*.06,-.45,.12)], [.065,.044,.022],"body",f"foot_{side}",12)
            b.rounded(f"Sticky toe {side} {i}",(x+i*.06,-.45,.12),(.052,.055,.028),"cream",f"foot_{side}",12,8)
    for i,(x,height) in enumerate(((-.20,.16),(0,.29),(.20,.20))):
        b.rounded(f"Rounded crest {i}",(x,.03,2.18+height*.4),(.12,.095,height),"accent","head",24,16,
            deform=lambda x,y,z:(x*(1-.25*z),y,z))
    p,r=b.smooth_path([(0,.24,.38),(.43,.46,.27),(.80,.48,.40),(1.03,.40,.69),(1.10,.31,1.01),(.98,.20,1.24),(.79,.14,1.28),(.73,.12,1.16)], [.20,.19,.16,.13,.10,.07,.04,.004],3)
    b.tube("Long curled tail",p,r,"body","tail",20)
    for i,(x,y,z) in enumerate(((.57,.31,.33),(.86,.33,.55),(1.01,.24,.84))):
        b.rounded(f"Tail scale {i}",(x,y,z),(.07,.025,.07),"accent","tail",16,10)
    bones={"root":((0,0,.1),(0,0,.6),None),"head":((0,0,1.36),(0,0,1.95),"root"),**eye_bones(centers),
        "arm_L":((-.35,0,1.20),(-.59,-.12,.97),"root"),"arm_R":((.35,0,1.20),(.59,-.12,.97),"root"),
        "foot_L":((-.32,0,.18),(-.32,-.22,.18),"root"),"foot_R":((.32,0,.18),(.32,-.22,.18),"root"),
        "tail":((0,.24,.38),(.43,.46,.27),"root")}
    b.make_rig(bones)
    for frame in (1,31,61,91,121):
        phase=(frame-1)/120*math.tau
        breath=.5-.5*math.cos(phase)
        b.key("root",frame,scale=(1+.01*breath,1+.013*breath,1+.007*breath))
        b.key("tail",frame,rotation=(.025*math.sin(phase),.035*math.sin(phase),0))
        for side,sign in (("L",-1),("R",1)):
            b.key(f"arm_{side}",frame,rotation=(0,0,sign*.025*math.sin(phase)))
    b.finish_action("idle",121)
    for frame,height,squash,spread in [(1,0,1,0),(10,-.035,.90,.05),(19,.16,1.05,.45),(25,.30,1,.65),(31,.18,1,.50),(40,0,.9,.10),(49,0,1.02,0),(60,0,1,0)]:
        b.key("root",frame,location=(0,height,0),scale=(1+(1-squash)*.5,squash,1+(1-squash)*.4))
        for side,sign in (("L",-1),("R",1)):
            q=Quaternion((0,1,0),-sign*spread)
            b.key(f"arm_{side}",frame,rotation=b.world_rotation(f"arm_{side}",q))
        b.key("tail",frame,rotation=(0,.10*spread,0))
    b.finish_action("greet",60)
    return b


def axolotl():
    b=CreatureBuilder("tide-axolotl",{"body":"5ba5a3","cream":"d7ead1","accent":"ef9b91"})
    b.rounded("Amphibian abdomen",(0,.055,.68),(.48,.36,.58),"body",segments=40,rings=24,
        deform=lambda x,y,z:(x*(1-.12*z),y,z))
    body_surface=lambda x,z:.055-.36*math.sqrt(max(.01,1-(x/.48)**2-((z-.68)/.58)**2))-.01
    b.patch("Soft belly",0,.65,.30,.40,"cream",body_surface,"root",rings=10,segments=36)
    b.rounded("Broad smiling head",(0,-.015,1.48),(.75,.43,.43),"body","head",44,26,
        deform=lambda x,y,z:(x*(1+.06*-z),y*(1+.06*-z),z))
    head_surface=lambda x,z:-.015-.43*(1+.06*-(z-1.48)/.43)*math.sqrt(max(.015,1-(x/(.75*(1+.06*-(z-1.48)/.43)))**2-((z-1.48)/.43)**2))-.009
    b.patch("Face underside",0,1.28,.55,.17,"cream",head_surface,"head",rings=10,segments=36)
    centers=((-0.365,-.382,1.60),(.365,-.382,1.60))
    b.eyes(*centers,radii=(.165,.065,.19),surface=head_surface)
    # An open, upward-curving smile is part of the flat amphibian snout.
    b.patch("Happy mouth",0,1.30,.285,.07,"nose",lambda x,z:head_surface(x,z)-.009,"head",rings=8,segments=32,
        shape=lambda x,z:(x,z+.65*x*x))
    b.patch("Tongue",0,1.277,.115,.028,"accent",lambda x,z:head_surface(x,z)-.018,"head",rings=6,segments=24)
    for sign,side in ((-1,"L"),(1,"R")):
        b.rounded(f"Nostril {side}",(sign*.12,-.449,1.43),(.012,.006,.009),"nose","head",12,8)
        # Three branching coral gills on each cheek: top, lateral, and lower.
        starts=[(sign*.60,.015,1.69),(sign*.65,.015,1.52),(sign*.61,.015,1.36)]
        ends=[(sign*1.00,.015,2.11),(sign*1.17,.015,1.69),(sign*1.02,.015,1.18)]
        for j,(start,end) in enumerate(zip(starts,ends)):
            mid=tuple((start[k]+end[k])*.5 for k in range(3))
            p,r=b.smooth_path([start,mid,end],[.075,.062,.013],4)
            b.tube(f"Gill stem {side} {j}",p,r,"accent",f"gill_{side}",14)
            b.rounded(f"Gill tip {side} {j}",end,(.038,.038,.048),"accent",f"gill_{side}",12,8)
            dx,dz=end[0]-start[0],end[2]-start[2]
            for k in (0,1):
                t=.42+k*.25
                fork=(start[0]+dx*t,0,start[2]+dz*t)
                # Alternate forks point away from the central gill shaft.
                branch=(fork[0]+sign*(.14 if j!=1 else .07),-.012,fork[2]+(.10 if j<2 else -.10))
                branchmid=tuple((fork[c]+branch[c])*.5 for c in range(3))
                b.tube(f"Gill branch {side} {j} {k}",[fork,branchmid,branch],[.034,.028,.009],"accent",f"gill_{side}",10)
                b.rounded(f"Gill bud {side} {j} {k}",branch,(.032,.031,.038),"accent",f"gill_{side}",12,8)
        p,r=b.smooth_path([(sign*.30,.005,.94),(sign*.47,-.04,.89),(sign*.57,-.16,.72),(sign*.60,-.20,.65)],[.05,.115,.10,.02],3)
        b.tube(f"Front limb {side}",p,r,"body",f"arm_{side}",16)
        for i in (-1,0,1):
            x=sign*.59+i*.049
            b.tube(f"Hand digit {side} {i}",[(x,-.22,.72),(x+i*.018,-.27,.65),(x+i*.023,-.275,.62)],[.03,.022,.008],"cream",f"arm_{side}",10)
        b.rounded(f"Hind leg {side}",(sign*.34,.02,.23),(.22,.25,.21),"body",f"foot_{side}",24,14)
        for i in (-1,0,1):
            x=sign*.34+i*.09
            b.tube(f"Hind toe {side} {i}",[(x,-.17,.15),(x+i*.025,-.30,.11),(x+i*.04,-.34,.11)],[.055,.037,.006],"cream",f"foot_{side}",10)
    p,r=b.smooth_path([(.08,.29,.31),(.38,.45,.30),(.65,.46,.42),(.80,.43,.64)],[.17,.15,.12,.08],3)
    b.tube("Tail stalk",p,r,"body","tail",20)
    b.rounded("Paddle tail fin",(.85,.43,.83),(.22,.065,.43),"accent","tail",32,20,
        deform=lambda x,y,z:(x+.35*z,y,z))
    b.rounded("Paddle core",(.85,.365,.81),(.14,.024,.31),"body","tail",28,16,
        deform=lambda x,y,z:(x+.35*z,y,z))
    bones={"root":((0,0,.10),(0,0,.55),None),"head":((0,0,1.04),(0,0,1.65),"root"),**eye_bones(centers),
        "arm_L":((-.34,0,.94),(-.55,-.15,.74),"root"),"arm_R":((.34,0,.94),(.55,-.15,.74),"root"),
        "foot_L":((-.34,0,.2),(-.34,-.21,.2),"root"),"foot_R":((.34,0,.2),(.34,-.21,.2),"root"),
        "gill_L":((-.60,.015,1.52),(-.9,.015,1.65),"head"),"gill_R":((.60,.015,1.52),(.9,.015,1.65),"head"),
        "tail":((.08,.29,.31),(.38,.45,.30),"root")}
    b.make_rig(bones)
    for frame in (1,31,61,91,121):
        phase=(frame-1)/120*math.tau
        b.key("root",frame,scale=(1+.008*(1-math.cos(phase)),1+.009*(1-math.cos(phase)),1))
        b.key("tail",frame,rotation=(.03*math.sin(phase),0,.04*math.sin(phase)))
        for side,sign in (("L",-1),("R",1)):
            b.key(f"gill_{side}",frame,rotation=(.025*math.sin(phase),0,sign*.02*math.sin(phase)))
    b.finish_action("idle",121)
    for frame,lift,wave in [(1,0,0),(12,.5,0),(23,1.1,-.13),(31,1.1,.13),(39,1.1,-.13),(47,1.1,.13),(59,.6,0),(72,0,0)]:
        for side,sign in (("L",-1),("R",1)):
            q=Quaternion((0,1,0),-sign*(lift+wave))@Quaternion((1,0,0),.24*min(lift,1))
            b.key(f"arm_{side}",frame,rotation=b.world_rotation(f"arm_{side}",q))
            b.key(f"gill_{side}",frame,rotation=(0,0,sign*.04*math.sin(frame/72*math.tau)))
        b.key("root",frame,location=(0,.018*min(lift,1),0))
    b.finish_action("greet",72)
    return b


def jerboa():
    b = CreatureBuilder("spark-jerboa", {"body": "d6a739", "cream": "fff0ba", "accent": "bd6a32"})
    # A desert hopper with elongated hind feet and a curling star-tipped tail.
    # Cream cheek fans, oval ears, and a narrow torso give it its own silhouette.
    b.rounded("Hopper torso", (0, .035, .69), (.34, .28, .49), "body", segments=36, rings=22,
        deform=lambda x,y,z: (x*(1-.18*z), y-.035*z, z))
    body_surface = lambda x,z: .035-.28*math.sqrt(max(.015,1-(x/(.34*(1-.18*(z-.69)/.49)))**2-((z-.69)/.49)**2))-.01
    b.patch("Cream vest", 0,.69,.23,.35,"cream",body_surface,"root",rings=10,segments=32)
    b.rounded("Round alert head", (0,-.015,1.35), (.52,.38,.46), "body", "head", 40,24,
        deform=lambda x,y,z: (x*(1+.055*-z), y, z))
    head_surface = lambda x,z: -.015-.38*math.sqrt(max(.015,1-(x/(.52*(1+.055*-(z-1.35)/.46)))**2-((z-1.35)/.46)**2))-.009
    centers=((-0.25,-.348,1.47),(.25,-.348,1.47))
    b.eyes(*centers,radii=(.14,.063,.185),surface=head_surface)
    for sign,side in ((-1,"L"),(1,"R")):
        b.rounded(f"Cream muzzle {side}",(sign*.105,-.355,1.17),(.16,.095,.115),"cream","head",24,16)
        b.rounded(f"Cheek fan {side}",(sign*.41,-.145,1.14),(.16,.09,.14),"cream","head",24,14,
            deform=lambda x,y,z:(x*(1+.18*z),y,z))
        for index,z in enumerate((1.10,1.20)):
            p,r=b.smooth_path([(sign*.40,-.15,z),(sign*.53,-.13,z+.025),(sign*.58,-.10,z+.07)],[.07,.045,.002],3)
            b.tube(f"Cheek tuft {side} {index}",p,r,"cream","head",12)
        # Ears have a rounded taper and slight asymmetric bends, with inset lining.
        center=(sign*.27,.015,2.06 if side=="L" else 2.03)
        bend = -.20 if side=="L" else .25
        b.rounded(f"Tall ear {side}",center,(.15,.09,.56),"body",f"ear_{side}",28,20,
            deform=lambda x,y,z,sg=sign,k=bend:(x*(1-.35*z)+sg*(.30*z+k*z*z),y+.12*z*z,z))
        b.rounded(f"Ear lining {side}",(center[0],center[1]-.075,center[2]+.04),(.095,.025,.425),"accent",f"ear_{side}",24,18,
            deform=lambda x,y,z,sg=sign,k=bend:(x*(1-.35*z)+sg*(.48*z+k*z*z),y+.20*z*z,z))
        # Long hindfeet are a defining jerboa feature, with soft cream toe tips.
        b.rounded(f"Spring haunch {side}",(sign*.26,.08,.36),(.20,.23,.29),"body","root",24,16)
        b.rounded(f"Long hind foot {side}",(sign*.27,-.18,.13),(.145,.36,.125),"body",f"foot_{side}",28,16,
            deform=lambda x,y,z:(x*(1-.12*y),y,z))
        b.rounded(f"Cream toe {side}",(sign*.27,-.43,.145),(.125,.14,.085),"cream",f"foot_{side}",24,14)
        p,r=b.smooth_path([(sign*.235,0,.96),(sign*.35,-.06,.86),(sign*.38,-.145,.73)],[.075,.095,.065],4)
        b.tube(f"Short arm {side}",p,r,"body",f"arm_{side}",16)
        b.rounded(f"Little paw {side}",(sign*.38,-.15,.73),(.09,.10,.10),"cream",f"arm_{side}",22,14)
        for i in (-1,1):
            b.tube(f"Paw crease {side} {i}",[(sign*.38+i*.025,-.246,.715),(sign*.38+i*.023,-.242,.745)],[.003,.003],"accent",f"arm_{side}",6)
    b.rounded("Heart nose",(0,-.452,1.27),(.06,.035,.039),"nose","head",24,14,
        deform=lambda x,y,z:(x*(1+.35*z),y,z))
    b.tube("Muzzle center",[(0,-.448,1.25),(0,-.454,1.205)],[.006,.006],"nose","head",8)
    for sign in (-1,1):
        b.tube(f"Gentle smile {sign}",[(0,-.454,1.205),(sign*.055,-.448,1.18),(sign*.10,-.435,1.20)],[.006,.008,.003],"nose","head",8)
    p,r=b.smooth_path([(.04,.23,.43),(.40,.40,.35),(.72,.38,.47),(.90,.31,.75),(.87,.20,1.04),(.71,.12,1.18),(.57,.10,1.12)],[.075,.065,.052,.045,.04,.032,.02],4)
    b.tube("Curling tail",p,r,"body","tail",16)
    # Smooth five-point tuft, built as a shallow padded star rather than a flat icon.
    center=(.57,.10,1.12)
    vertices,faces=[],[]
    segments,rings=50,12
    for j in range(rings+1):
        theta=math.pi*j/rings
        depth=math.cos(theta)*.055
        span=math.sin(theta)
        for i in range(segments):
            angle=math.tau*i/segments+math.pi/2
            radius=.17*(.79+.21*math.cos(5*(angle-math.pi/2)))
            vertices.append((center[0]+math.cos(angle)*radius*span,center[1]+depth,center[2]+math.sin(angle)*radius*span))
    for j in range(rings):
        for i in range(segments):
            a=j*segments+i;c=a+segments;d=j*segments+(i+1)%segments+segments;e=j*segments+(i+1)%segments
            faces.append((a,c,d,e))
    b.mesh("Star tail tuft",vertices,faces,"accent","tail")
    bones={"root":((0,0,.1),(0,0,.55),None),"head":((0,0,1.0),(0,0,1.6),"root"),**eye_bones(centers),
        "arm_L":((-.24,0,.96),(-.36,-.1,.78),"root"),"arm_R":((.24,0,.96),(.36,-.1,.78),"root"),
        "foot_L":((-.27,0,.18),(-.27,-.25,.18),"root"),"foot_R":((.27,0,.18),(.27,-.25,.18),"root"),
        "ear_L":((-.24,.015,1.65),(-.30,.015,2.18),"head"),"ear_R":((.24,.015,1.65),(.30,.015,2.18),"head"),
        "tail":((.04,.23,.43),(.40,.40,.35),"root")}
    b.make_rig(bones)
    for frame in (1,31,61,91,121):
        phase=(frame-1)/120*math.tau
        breath=.5-.5*math.cos(phase)
        b.key("root",frame,scale=(1+.012*breath,1+.012*breath,1+.008*breath))
        b.key("tail",frame,rotation=(.025*math.sin(phase),.04*math.sin(phase),0))
        for side,sign in (("L",-1),("R",1)):
            b.key(f"ear_{side}",frame,rotation=(.018*math.sin(phase),.025*sign*math.sin(phase),0))
    b.finish_action("idle",121)
    for frame,height,squash,spread in [(1,0,1,0),(10,-.035,.91,.12),(18,.14,1.04,.65),(25,.27,1,1.0),(32,.15,1,.85),(42,0,.92,.65),(52,0,1.02,.3),(67,0,1,0)]:
        b.key("root",frame,location=(0,height,0),scale=(1+(1-squash)*.35,squash,1+(1-squash)*.4))
        for side,sign in (("L",-1),("R",1)):
            q=Quaternion((0,1,0),-sign*spread)@Quaternion((1,0,0),.2*min(spread,1))
            b.key(f"arm_{side}",frame,rotation=b.world_rotation(f"arm_{side}",q))
            b.key(f"ear_{side}",frame,rotation=(0,sign*.10*min(spread,1),0))
            b.key(f"foot_{side}",frame,rotation=(.12*min(spread,1),0,0))
        b.key("tail",frame,rotation=(0,.10*math.sin(frame/67*math.tau),0))
    b.finish_action("greet",67)
    return b


if __name__=="__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("--character",choices=("ember-gecko","tide-axolotl","spark-jerboa"),required=True)
    parser.add_argument("--render",action="store_true")
    parser.add_argument("--pose",choices=("neutral","greet","blink"),default="neutral")
    args=parser.parse_args(sys.argv[sys.argv.index("--")+1:] if "--" in sys.argv else [])
    builder={"ember-gecko":gecko,"tide-axolotl":axolotl,"spark-jerboa":jerboa}[args.character]()
    builder.export(render=args.render,render_pose=args.pose)
