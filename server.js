'use strict';
const http = require('node:http');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT || 3000);
const ADMIN_HELPER_KEY = process.env.ADMIN_HELPER_KEY || '';
const NVNMC_PANEL_URL = (process.env.NVNMC_PANEL_URL || 'https://panel.nvnmc.cloud').replace(/\/+$/, '');
const NVNMC_SERVER_IDENTIFIER = process.env.NVNMC_SERVER_IDENTIFIER || '';
const NVNMC_API_KEY = process.env.NVNMC_API_KEY || '';
const TOKEN_TTL_MS = Math.max(5, Number(process.env.TOKEN_TTL_MINUTES || 60)) * 60 * 1000;
const PERMISSIONS = (process.env.ADMIN_HELPER_PERMISSIONS || 'status,players,announce,kick')
  .split(',').map(s => s.trim()).filter(s => ['status','players','announce','kick'].includes(s));
const sessions = new Map();
const ipCounts = new Map();

function send(res, code, body) {
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(code, { 'Content-Type':'application/json; charset=utf-8', 'Content-Length':data.length,
    'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'no-referrer' });
  res.end(data);
}
function safeEqual(a, b) { const x=Buffer.from(String(a)); const y=Buffer.from(String(b)); return x.length===y.length && x.length>0 && crypto.timingSafeEqual(x,y); }
function getIp(req) { return (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').toString().split(',')[0].trim(); }
function rateAllowed(req) { const ip=getIp(req), now=Date.now(); let e=ipCounts.get(ip); if(!e || now-e.start>60000)e={start:now,count:0}; e.count++;ipCounts.set(ip,e); if(ipCounts.size>10000)for(const [k,v] of ipCounts)if(now-v.start>60000)ipCounts.delete(k); return e.count<=60; }
function readJson(req) { return new Promise((resolve,reject)=>{let raw='',size=0;req.on('data',c=>{size+=c.length;if(size>16384){reject(new Error('Dữ liệu quá lớn.'));req.destroy();}else raw+=c.toString('utf8');});req.on('end',()=>{if(!raw)return resolve({});try{resolve(JSON.parse(raw));}catch{reject(new Error('JSON không hợp lệ.'));}});req.on('error',reject);}); }
function authorized(req, permission) { const m=/^Bearer ([A-Za-z0-9_-]+)$/.exec(req.headers.authorization||''); if(!m)return null;const s=sessions.get(m[1]);if(!s||s.expires<=Date.now()){sessions.delete(m?.[1]);return null;}if(permission&&!s.permissions.includes(permission))return {forbidden:true};return s; }
function cleanText(v,max=240) { if(typeof v!=='string')return ''; return v.replace(/[\r\n\u0000-\u001f\u007f]/g,' ').trim().slice(0,max); }
async function panelApi(path, method='GET', body) {
  if(!NVNMC_SERVER_IDENTIFIER || !NVNMC_API_KEY) throw new Error('Backend chưa cấu hình NVNMC_SERVER_IDENTIFIER và NVNMC_API_KEY.');
  const response = await fetch(`${NVNMC_PANEL_URL}/api/client/servers/${encodeURIComponent(NVNMC_SERVER_IDENTIFIER)}${path}`, {
    method, headers:{'Authorization':`Bearer ${NVNMC_API_KEY}`,'Accept':'application/vnd.pterodactyl.v1+json','Content-Type':'application/json'},
    ...(body === undefined ? {} : {body:JSON.stringify(body)}), signal:AbortSignal.timeout(10000)
  });
  const raw = await response.text(); let data={}; try{data=raw?JSON.parse(raw):{};}catch{data={message:raw.slice(0,300)};}
  if(!response.ok) { const e=new Error(response.status===401||response.status===403?'NVNMC API từ chối quyền. Kiểm tra API key và quyền của key.':`NVNMC API trả lỗi HTTP ${response.status}.`); e.status=response.status; throw e; }
  return data;
}
async function consoleCommand(command) { return panelApi('/command','POST',{command}); }
function serverError(res,e) { const msg=String(e&&e.message||'Lỗi máy chủ'); const safe=/NVNMC API|Backend chưa cấu hình|HTTP 4\d\d|HTTP 5\d\d|timeout/i.test(msg)?msg:'Không thể hoàn thành thao tác với máy chủ NVNMC.'; send(res,503,{error:safe}); }

const server=http.createServer(async(req,res)=>{
  if(!rateAllowed(req))return send(res,429,{error:'Quá nhiều yêu cầu. Thử lại sau một phút.'});
  const url=new URL(req.url,`http://${req.headers.host||'localhost'}`);
  if(req.method==='GET'&&url.pathname==='/health')return send(res,200,{ok:true,service:'ANIUX AI Admin Phu backend',provider:'NVNMC Client API'});
  if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type,Authorization'});return res.end();}
  if(req.method==='POST'&&url.pathname==='/api/helper/login'){
    if(!ADMIN_HELPER_KEY)return send(res,503,{error:'Chưa cấu hình ADMIN_HELPER_KEY trên hosting.'});
    let body;try{body=await readJson(req);}catch(e){return send(res,400,{error:e.message});}
    if(!safeEqual(cleanText(body.key,512),ADMIN_HELPER_KEY))return send(res,401,{error:'Mã admin phụ không đúng.'});
    const token=crypto.randomBytes(32).toString('base64url');sessions.set(token,{permissions:PERMISSIONS.slice(),expires:Date.now()+TOKEN_TTL_MS});
    return send(res,200,{token,permissions:PERMISSIONS,expiresIn:TOKEN_TTL_MS/1000});
  }
  const routePermissions={'/api/helper/status':'status','/api/helper/players':'players','/api/helper/announce':'announce','/api/helper/kick':'kick'};
  const permission=routePermissions[url.pathname];if(!permission)return send(res,404,{error:'Không tìm thấy endpoint.'});
  const session=authorized(req,permission);if(!session)return send(res,401,{error:'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.'});if(session.forbidden)return send(res,403,{error:'Mã admin phụ không có quyền này.'});
  try {
    if(req.method==='GET'&&url.pathname==='/api/helper/status'){
      const data=await panelApi('/resources');const a=data.attributes||{};
      return send(res,200,{ok:true,server:'NVNMC Minecraft Server',state:a.current_state||a.state||'unknown',isSuspended:!!a.is_suspended,resources:a.resources||null,identifier:NVNMC_SERVER_IDENTIFIER});
    }
    if(req.method==='GET'&&url.pathname==='/api/helper/players'){
      // Pterodactyl Client API accepts console commands but does not synchronously return console output.
      await consoleCommand('list');
      return send(res,200,{ok:true,message:'Đã gửi lệnh list tới console NVNMC. Xem kết quả tại mục Console của NVNMC.',note:'API Client không trả về đầu ra console trực tiếp.'});
    }
    if(req.method!=='POST')return send(res,405,{error:'Phương thức không được hỗ trợ.'});
    let body;try{body=await readJson(req);}catch(e){return send(res,400,{error:e.message});}
    if(url.pathname==='/api/helper/announce'){
      const message=cleanText(body.message,200);if(!message)return send(res,400,{error:'Nội dung thông báo không được để trống.'});
      // Only fixed command form; no arbitrary commands accepted from the client.
      await consoleCommand(`say [SỰ KIỆN] ${message}`);
      return send(res,200,{ok:true,message:'Đã gửi thông báo tới console NVNMC.'});
    }
    if(url.pathname==='/api/helper/kick'){
      const player=typeof body.player==='string'?body.player.trim():'';if(!/^[A-Za-z0-9_]{1,16}$/.test(player))return send(res,400,{error:'Tên người chơi không hợp lệ (Java 1–16 ký tự).'});
      const reason=cleanText(body.reason||'Bị kick bởi quản trị viên',100).replace(/\\/g,' ').replace(/"/g,"'");
      await consoleCommand(`kick ${player} ${reason||'Bị kick bởi quản trị viên'}`);
      return send(res,200,{ok:true,message:`Đã gửi lệnh kick cho ${player} tới console NVNMC.`});
    }
    return send(res,404,{error:'Không tìm thấy endpoint.'});
  }catch(e){serverError(res,e);}
});
server.listen(PORT,'0.0.0.0',()=>console.log(`ANIUX backend listening on ${PORT}`));
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
