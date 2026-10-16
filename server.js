import 'dotenv/config';
import express from 'express';
import Stripe from 'stripe';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
const app=express();
const stripe=process.env.STRIPE_SECRET_KEY?new Stripe(process.env.STRIPE_SECRET_KEY):null;
const dbPath=path.resolve(process.env.DATA_FILE||'./nova-data.json');
let db={users:{},sessions:{},jobs:{},events:{}};
try {db=Object.assign(db,JSON.parse(fs.readFileSync(dbPath,'utf8')));}catch{}
function save(){const tmp=dbPath+'.tmp';fs.writeFileSync(tmp,JSON.stringify(db,null,2),{mode:0o600});fs.renameSync(tmp,dbPath)}
const safe=(u)=>u?{email:u.email,credits:u.credits||0,active:u.active===true}:null;
const jsonError=(res,message,code=400)=>res.status(code).json({error:message});
const cookie=(req)=>{const val=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('nova_session='));return val?decodeURIComponent(val.split('=').slice(1).join('=')):''};
function current(req){const t=cookie(req),s=db.sessions[t];if(!s)return null;if(s.expires<Date.now()){delete db.sessions[t];save();return null}return db.users[s.email]||null}
function auth(req,res,next){const u=current(req);if(!u)return jsonError(res,'Please sign in first.',401);req.user=u;next()}
const hash=(password,salt)=>scryptSync(password,salt,64).toString('hex');
const setSession=(res,email)=>{const t=randomBytes(32).toString('hex');db.sessions[t]={email,expires:Date.now()+30*86400000};save();res.cookie('nova_session',t,{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',maxAge:30*86400000,path:'/'});};
function markPaid(u,subscription){u.active=true;u.subscriptionId=subscription||u.subscriptionId;u.credits=Math.max(10,u.credits||0)}
// Stripe requires the RAW request body for webhook signature verification.
app.post('/api/stripe/webhook',express.raw({type:'application/json'}),async(req,res)=>{
 if(!stripe||!process.env.STRIPE_WEBHOOK_SECRET)return res.status(503).send('Stripe not set up');
 let event;try{event=stripe.webhooks.constructEvent(req.body,req.headers['stripe-signature'],process.env.STRIPE_WEBHOOK_SECRET)}catch{return res.status(400).send('Bad signature')}
 if(db.events[event.id])return res.json({received:true});
 try{
  const o=event.data.object;
  if(event.type==='checkout.session.completed'&&o.mode==='subscription'&&o.payment_status!=='unpaid'){
   const email=o.client_reference_id;const u=db.users[email];if(u){u.customerId=o.customer;markPaid(u,o.subscription)}
  }
  if(event.type==='invoice.paid'&&o.subscription){const u=Object.values(db.users).find(x=>x.subscriptionId===o.subscription||x.customerId===o.customer);if(u){u.active=true;u.subscriptionId=o.subscription;u.credits=10}}
  if(event.type==='customer.subscription.deleted'||event.type==='customer.subscription.updated'){
   const u=Object.values(db.users).find(x=>x.subscriptionId===o.id);if(u){u.active=['active','trialing'].includes(o.status);if(!u.active)u.credits=0}}
  db.events[event.id]=true;save();res.json({received:true});
 }catch{res.status(500).send('Webhook error')}
});
app.use(express.json({limit:'30kb'}));app.use(express.static('public'));
app.post('/api/signup',(req,res)=>{let {email,password}=req.body||{};email=String(email||'').trim().toLowerCase();if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)||email.length>160)return jsonError(res,'Enter a valid email.');if(typeof password!=='string'||password.length<10||password.length>128)return jsonError(res,'Password must be at least 10 characters.');if(db.users[email])return jsonError(res,'Account already exists. Sign in instead.');const salt=randomBytes(16).toString('hex');db.users[email]={email,salt,passwordHash:hash(password,salt),credits:0,active:false};save();setSession(res,email);res.json({user:safe(db.users[email])})});
app.post('/api/login',(req,res)=>{const email=String(req.body?.email||'').trim().toLowerCase();const pw=req.body?.password;const u=db.users[email];if(!u||typeof pw!=='string')return jsonError(res,'Incorrect email or password.',401);const attempt=Buffer.from(hash(pw,u.salt),'hex');if(!timingSafeEqual(attempt,Buffer.from(u.passwordHash,'hex')))return jsonError(res,'Incorrect email or password.',401);setSession(res,email);res.json({user:safe(u)})});
app.post('/api/logout',(req,res)=>{delete db.sessions[cookie(req)];save();res.clearCookie('nova_session',{path:'/'});res.json({ok:true})});
app.get('/api/me',(req,res)=>res.json({user:safe(current(req)),aiConfigured:!!process.env.REPLICATE_API_TOKEN,stripeConfigured:!!(stripe&&process.env.STRIPE_PRICE_ID&&process.env.PUBLIC_URL)}));
app.post('/api/checkout',auth,async(req,res)=>{if(!stripe||!process.env.STRIPE_PRICE_ID||!process.env.PUBLIC_URL)return jsonError(res,'Payments are not configured yet.',503);if(req.user.active)return jsonError(res,'Your subscription is already active.');try{const session=await stripe.checkout.sessions.create({mode:'subscription',line_items:[{price:process.env.STRIPE_PRICE_ID,quantity:1}],client_reference_id:req.user.email,customer_email:req.user.customerId?undefined:req.user.email,customer:req.user.customerId||undefined,success_url:process.env.PUBLIC_URL+'/?checkout=success',cancel_url:process.env.PUBLIC_URL+'/?checkout=cancel',allow_promotion_codes:true});res.json({url:session.url})}catch(e){jsonError(res,'Could not open checkout. Verify Stripe settings.',502)}});
app.post('/api/portal',auth,async(req,res)=>{if(!stripe||!req.user.customerId||!process.env.PUBLIC_URL)return jsonError(res,'Billing portal is not available.',503);try{const s=await stripe.billingPortal.sessions.create({customer:req.user.customerId,return_url:process.env.PUBLIC_URL});res.json({url:s.url})}catch{jsonError(res,'Unable to open billing portal.',502)}});
const api='https://api.replicate.com/v1';const headers=()=>({'Authorization':`Bearer ${process.env.REPLICATE_API_TOKEN}`,'Content-Type':'application/json'});
app.post('/api/generate',auth,async(req,res)=>{
 const u=req.user,prompt=req.body?.prompt;
 if(!u.active||u.credits<1)return jsonError(res,'An active subscription with credits is required.',402);
 if(!process.env.REPLICATE_API_TOKEN)return jsonError(res,'Video generation has not been connected by the owner.',503);
 if(typeof prompt!=='string'||prompt.trim().length<5||prompt.length>1500)return jsonError(res,'Write a prompt between 5 and 1,500 characters.');
 if(Object.values(db.jobs).some(j=>j.email===u.email&&!j.done))return jsonError(res,'Finish your current video before starting another.');
 // Reserve one credit before contacting paid inference API.
 u.credits-=1;const reservation='pending-'+randomBytes(8).toString('hex');db.jobs[reservation]={email:u.email,done:false};save();
 try{const r=await fetch(api+'/models/minimax/video-01/predictions',{method:'POST',headers:headers(),body:JSON.stringify({input:{prompt:prompt.trim(),prompt_optimizer:true}})});const data=await r.json();if(!r.ok)throw new Error(data.detail||'Service rejected job');delete db.jobs[reservation];db.jobs[data.id]={email:u.email,done:false,created:Date.now()};save();res.json({id:data.id,status:data.status,credits:u.credits})}catch{delete db.jobs[reservation];u.credits+=1;save();jsonError(res,'Could not start generation. Your credit was returned.',502)}
});
app.get('/api/predictions/:id',auth,async(req,res)=>{const job=db.jobs[req.params.id];if(!job||job.email!==req.user.email)return jsonError(res,'Video not found.',404);if(!process.env.REPLICATE_API_TOKEN)return jsonError(res,'Video service not configured.',503);try{const r=await fetch(api+'/predictions/'+encodeURIComponent(req.params.id),{headers:headers()});const d=await r.json();if(!r.ok)throw Error();const out=Array.isArray(d.output)?d.output[0]:d.output;const video=typeof out==='string'&&out.startsWith('https://')?out:null;
 if(['failed','canceled'].includes(d.status)&&!job.done){req.user.credits+=1;job.done=true;save()}
 if(d.status==='succeeded'&&!job.done){job.done=true;save()}
 res.json({status:d.status,video,error:d.error||null,credits:req.user.credits})}catch{jsonError(res,'Could not check video status.',502)}});
app.use(express.static('public'));
const port=Number(process.env.PORT)||3000;app.listen(port,()=>console.log('NOVA listening on '+port));
