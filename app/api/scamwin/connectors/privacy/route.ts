import {eraseConnectedDataAction} from '@/app/scamwin/integration-actions';
export async function POST(request:Request){
 const headers={'Cache-Control':'private, no-store'};
 let origin:string|null=null;try{origin=new URL(process.env.APP_BASE_URL??'').origin;}catch{}
 if(!origin||request.headers.get('origin')!==origin)return Response.json({ok:false,error:'Start this action from your account.'},{status:403,headers});
 const text=await request.text();if(text.length>1024)return Response.json({ok:false,error:'Invalid confirmation.'},{status:400,headers});
 let input:unknown;try{input=JSON.parse(text);}catch{return Response.json({ok:false,error:'Invalid confirmation.'},{status:400,headers});}
 const result=await eraseConnectedDataAction(input);return Response.json(result,{status:result.ok?200:result.code==='unauthenticated'?401:400,headers});
}
