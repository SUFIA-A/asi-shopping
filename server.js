require("dotenv").config();
const express=require("express");
const path=require("path");
const fs=require("fs");
const crypto=require("crypto");
const app=express();
app.use(express.json({limit:"3mb"}));
app.use(express.urlencoded({extended:true}));
app.use(express.static(path.join(__dirname,"public")));

const BASE="https://dropsourcebd.com/api/dropship/v1";
const DATA=path.join(__dirname,"data");
const API_KEY=process.env.DROPSOURCE_API_KEY||"";
const ADMIN_PASSWORD=process.env.ADMIN_PASSWORD||"change-this-password";
const sessions=new Map();

function readJson(file, fallback){try{return JSON.parse(fs.readFileSync(path.join(DATA,file),"utf8"))}catch{return fallback}}
function writeJson(file,data){fs.writeFileSync(path.join(DATA,file),JSON.stringify(data,null,2),"utf8")}
function settings(){return readJson("settings.json",{"markupPercent":30,"currency":"BDT","whatsapp":"8801874185030","facebookPage":""})}
function overrides(){return readJson("product-overrides.json",{})}
function orders(){return readJson("orders.json",[])}
function saveOrders(x){writeJson("orders.json",x)}
function headers(){
  if(!API_KEY) throw new Error("DROPSOURCE_API_KEY is not configured in .env");
  return {"Authorization":`Bearer ${API_KEY}`,"Accept":"application/json","Content-Type":"application/json"};
}
async function dsFetch(endpoint, options={}){
  const r=await fetch(`${BASE}${endpoint}`,{...options,headers:{...headers(),...(options.headers||{})}});
  let d={}; try{d=await r.json()}catch{}
  if(!r.ok) throw new Error(d.message||d.error||`DropSourceBD API error (${r.status})`);
  return d;
}
function auth(req,res,next){
  const token=req.headers.authorization?.replace(/^Bearer\s+/i,"")||req.cookies?.asi_admin;
  if(token&&sessions.has(token)) return next();
  return res.status(401).json({error:"Admin authentication required"});
}
function setSession(res){
  const token=crypto.randomBytes(32).toString("hex"); sessions.set(token,Date.now()+1000*60*60*12);
  res.setHeader("Set-Cookie",`asi_admin=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200`);
  return token;
}
setInterval(()=>{const now=Date.now();for(const [k,v] of sessions)if(v<now)sessions.delete(k)},60*60*1000);

app.post("/api/admin/login",(req,res)=>{
  if(!req.body?.password || req.body.password!==ADMIN_PASSWORD) return res.status(401).json({error:"Invalid admin password"});
  res.json({ok:true,token:setSession(res)});
});
app.post("/api/admin/logout",(req,res)=>{res.setHeader("Set-Cookie","asi_admin=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");res.json({ok:true})});
app.get("/api/admin/me",auth,(req,res)=>res.json({ok:true}));

function mapProduct(p,ov,sett){
  const cost=Number(p.price??p.reseller_price??0);
  const markup=ov.markupPercent==null?Number(sett.markupPercent||0):Number(ov.markupPercent);
  const calculated=Math.round(cost*(1+markup/100));
  const sell=ov.sellingPrice==null?calculated:Number(ov.sellingPrice);
  return {...p,cost,reseller_price:cost,markupPercent:markup,sellingPrice:sell,enabled:ov.enabled!==false};
}

app.get("/api/products",async(req,res)=>{
  try{
    const d=await dsFetch("/products");
    const raw=Array.isArray(d)?d:(d.products||d.data||d.items||[]);
    const ovs=overrides(),sett=settings();
    const products=raw.map(p=>mapProduct({
      id:p.id,title:p.title||p.name||"Product",name:p.name||p.title||"Product",
      slug:p.slug||"",code:p.code||"",category:p.category||"",description:p.description||"",
      short_description:p.short_description||"",currency:p.currency||"BDT",
      price:Number(p.price??p.reseller_price??0),reseller_price:Number(p.reseller_price??p.price??0),
      regular_price:Number(p.regular_price??0),in_stock:Boolean(p.in_stock),
      image:p.image||p.featured_image||"",images:Array.isArray(p.images)?p.images:[],
      colors:Array.isArray(p.colors)?p.colors:[],sizes:Array.isArray(p.sizes)?p.sizes:[],
      weights:Array.isArray(p.weights)?p.weights:[],variations:Array.isArray(p.variations)?p.variations:[]
    },ovs[p.id]||{},sett));
    res.json({products,settings:sett});
  }catch(e){res.status(500).json({error:e.message})}
});

app.get("/api/admin/products",auth,async(req,res)=>{
  try{
    const d=await dsFetch("/products");
    const raw=Array.isArray(d)?d:(d.products||d.data||d.items||[]);
    const ovs=overrides(),sett=settings();
    const products=raw.map(p=>mapProduct({
      id:p.id,title:p.title||p.name||"Product",name:p.name||p.title||"Product",
      code:p.code||"",category:p.category||"",price:Number(p.price??p.reseller_price??0),
      reseller_price:Number(p.reseller_price??p.price??0),regular_price:Number(p.regular_price??0),
      in_stock:Boolean(p.in_stock),image:p.image||p.featured_image||"",images:Array.isArray(p.images)?p.images:[]
    },ovs[p.id]||{},sett));
    res.json({products,settings:sett});
  }catch(e){res.status(500).json({error:e.message})}
});

app.put("/api/admin/settings",auth,(req,res)=>{
  const s=settings(); const m=Number(req.body.markupPercent);
  if(!Number.isFinite(m)||m<0||m>500)return res.status(422).json({error:"Markup must be between 0 and 500"});
  s.markupPercent=m;
  if(req.body.whatsapp!=null)s.whatsapp=String(req.body.whatsapp);
  if(req.body.facebookPage!=null)s.facebookPage=String(req.body.facebookPage);
  writeJson("settings.json",s);res.json({ok:true,settings:s});
});

app.put("/api/admin/products/:id",auth,(req,res)=>{
  const id=req.params.id, ovs=overrides(), old=ovs[id]||{};
  const next={...old};
  if(req.body.enabled!==undefined)next.enabled=!!req.body.enabled;
  if(req.body.markupPercent!==undefined){
    const m=Number(req.body.markupPercent); if(!Number.isFinite(m)||m<0||m>500)return res.status(422).json({error:"Invalid markup"});
    next.markupPercent=m;
  }
  if(req.body.sellingPrice!==undefined){
    const p=Number(req.body.sellingPrice); if(!Number.isFinite(p)||p<0)return res.status(422).json({error:"Invalid selling price"});
    next.sellingPrice=p;
  }
  ovs[id]=next;writeJson("product-overrides.json",ovs);res.json({ok:true,override:next});
});

app.get("/api/admin/orders",auth,(req,res)=>{
  const q=String(req.query.q||"").toLowerCase(), st=String(req.query.status||"").toLowerCase();
  let list=orders().filter(o=>(!q||JSON.stringify(o).toLowerCase().includes(q))&&(!st||String(o.status).toLowerCase()===st));
  list.sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));res.json({orders:list});
});

app.put("/api/admin/orders/:id",auth,(req,res)=>{
  const list=orders(), i=list.findIndex(o=>o.id===req.params.id);
  if(i<0)return res.status(404).json({error:"Order not found"});
  if(req.body.status)list[i].status=String(req.body.status);
  if(req.body.note!==undefined)list[i].note=String(req.body.note);
  list[i].updatedAt=new Date().toISOString();saveOrders(list);res.json({ok:true,order:list[i]});
});

app.get("/api/admin/stats",auth,(req,res)=>{
  const list=orders();res.json({
    productsOverrides:Object.keys(overrides()).length,
    orders:list.length,
    pending:list.filter(x=>["pending","submitted","processing"].includes(x.status)).length,
    revenue:list.reduce((a,o)=>a+Number(o.total||0),0)
  });
});

app.post("/api/orders",async(req,res)=>{
  try{
    const payload=req.body; if(!payload?.customer||!Array.isArray(payload.items)||!payload.items.length)return res.status(422).json({error:"Customer and items are required"});
    const localId="ASI-"+Date.now();
    const created={id:localId,status:"pending",createdAt:new Date().toISOString(),customer:payload.customer,items:payload.items,total:Number(payload.total||payload.items.reduce((a,x)=>a+Number(x.price||0)*Number(x.quantity||1),0))};
    const list=orders();list.push(created);saveOrders(list);
    let supplier=null;
    try{supplier=await dsFetch("/orders",{method:"POST",body:JSON.stringify(payload)});created.status="submitted";created.supplierResponse=supplier;saveOrders(list)}
    catch(e){created.status="api_error";created.supplierError=e.message;saveOrders(list);return res.status(502).json({error:e.message,localOrderId:localId})}
    res.json({ok:true,orderId:localId,supplier});
  }catch(e){res.status(500).json({error:e.message})}
});

app.get("/api/orders/track",async(req,res)=>{
  try{
    const qs=new URLSearchParams();
    for(const k of ["orderId","order_id","orderNumber","order_number"])if(req.query[k])qs.set(k,req.query[k]);
    const d=await dsFetch(`/orders/track?${qs.toString()}`);res.json(d);
  }catch(e){res.status(500).json({error:e.message})}
});

app.get("/health",(req,res)=>res.status(200).json({ok:true,service:"asi-shopping",time:new Date().toISOString()}));
app.get("/{*splat}",(req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
const PORT=Number(process.env.PORT||3000);
app.listen(PORT,"0.0.0.0",()=>console.log(`ASI Shopping running on port ${PORT}`));
