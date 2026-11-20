import argparse, base64, hashlib, hmac, json, math, os, re, secrets, sqlite3, threading, time, unicodedata
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit
from http.cookies import SimpleCookie

ROOT = Path(__file__).resolve().parent
PAGE = '잿빛-묘지.html'
FILES = {'반응-이모지.json', PAGE, '주식-종목목록.js', '페페-보행.js', '페페-유령.js', '광장.js', '광장.css'}
parser = argparse.ArgumentParser()
parser.add_argument('--port',type=int,default=8765)
parser.add_argument('--bind',default='127.0.0.1')
parser.add_argument('--data',default=str(ROOT/'.plaza'))
args=parser.parse_args()
folder=Path(args.data);folder.mkdir(exist_ok=True,parents=True)
db=sqlite3.connect(folder/'world.sqlite',check_same_thread=False,isolation_level=None)
db.row_factory=sqlite3.Row
db.executescript('''
CREATE TABLE IF NOT EXISTS people(id INTEGER PRIMARY KEY, nick TEXT NOT NULL, nickkey TEXT UNIQUE, code TEXT UNIQUE, role TEXT, stock TEXT, slot INTEGER UNIQUE);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, uid INTEGER);
CREATE TABLE IF NOT EXISTS config(secret BLOB);
CREATE TABLE IF NOT EXISTS reactions(target INTEGER NOT NULL, emoji TEXT NOT NULL, author INTEGER NOT NULL, PRIMARY KEY(target,emoji,author));
''')
if not db.execute('select 1 from config').fetchone():db.execute('insert into config values(?)',(secrets.token_bytes(32),))
secret=db.execute('select secret from config').fetchone()[0]
lock=threading.RLock()
presence={};attempts={}
catalog=json.loads((ROOT/'주식-종목목록.js').read_text('utf8').split('=',1)[1].rstrip(';'))
stocks={r[0]:r for r in reversed(catalog)}
slots=sorted(((x,z) for x in range(-23,24) for z in range(-23,24)),key=lambda p:(p[0]**2+p[1]**2,math.atan2(p[1],p[0])%(2*math.pi)))
bad='시발 씨발 씨팔 씨바 시팔 ㅅㅂ ㅆㅂ ㅂㅅ ㅈㄹ ㅈㄴ 병신 븅신 개새끼 개색끼 씹 좆 존나 지랄 염병 느금 니애미 니애비 창녀 창놈 걸레년 보지 자지 쥬지 섹스 쎅스 성기 강간 음란 야동 딸딸이 포르노 fuck shit bitch cunt dick pussy porn sex nigga nigger'.split()
def nickkey(s):
    return ''.join(c for c in unicodedata.normalize('NFKC',s).casefold() if c.isalnum())
def valid_nick(s):
    key=nickkey(s)
    mask=key.translate(str.maketrans('013457','oieast'))
    letters=''.join(c for c in key if not c.isdigit())
    return bool(re.fullmatch(r'[가-힣ㄱ-ㅎㅏ-ㅣa-zA-Z0-9 _.-]{2,12}',s) and len(key)>=2 and not any(nickkey(w) in text for w in bad for text in (key,mask,letters)))
def digest(text):return hmac.new(secret,text.encode(),'sha256').hexdigest()
def spawn(slot):return [4*axis for axis in slots[slot]]
def check_stock(d):
    r=stocks.get(d.get('symbol'))
    if not r:raise ValueError('종목을 다시 선택해 주세요.')
    basis=d.get('basis');logo=d.get('logo','')
    if type(basis) not in (float,int) or not math.isfinite(basis) or not 0<basis<=1e13:raise ValueError('매수평단을 확인해 주세요.')
    if not isinstance(logo,str) or not re.fullmatch('data:image/png;base64,[A-Za-z0-9+/=]{40,150000}',logo):raise ValueError('종목 로고를 확인해 주세요.')
    raw=base64.b64decode(logo.partition(',')[2],validate=True)
    if not raw.startswith(b'\x89PNG\r\n\x1a\n'):raise ValueError('종목 로고를 확인해 주세요.')
    return dict(symbol=r[0],name=r[1] or r[2],basis=basis,close=r[4],currency='KRW' if r[3].startswith('ko') else 'USD',logo=logo)
emoji_set={r[0] for r in json.loads((ROOT/'반응-이모지.json').read_text('utf8'))['rows']}
def players(known=(),viewer=None):
    counts={}
    for r in db.execute('SELECT target,emoji,count(*),max(author=?) FROM reactions GROUP BY target,emoji ORDER BY target,count(*) DESC,emoji',(viewer,)):
        counts.setdefault(r[0],[]).append([r[1],r[2],bool(r[3])])
    now=time.monotonic();out=[]
    for row in db.execute('select id,nick,role,stock,slot from people order by slot'):
        uid=row['id'];x,z=spawn(row['slot']);pos=presence.get(uid,{})
        if now-pos.get('time',-999)>12:pos={}
        out.append(dict(reactions=counts.get(uid,[]),id=uid,nick=row['nick'],role=row['role'],stock=json.loads(row['stock']) if row['stock'] else None,x=x,z=z,moving=pos.get('moving'),slot=row['slot']))
    for p in out:
        if p["id"] in known and p["stock"]:p["stock"].pop("logo",None)
    return out
class Handler(BaseHTTPRequestHandler):
    def log_message(self,*a):pass
    def reply(self,status,data,mime='application/json',cookie=None):
        body=data if isinstance(data,bytes) else json.dumps(data,ensure_ascii=False).encode()
        self.send_response(status);self.send_header('Content-Type',mime);self.send_header('Content-Length',str(len(body)));self.send_header('Cache-Control','no-store')
        if cookie:self.send_header('Set-Cookie',cookie)
        self.end_headers()
        try:self.wfile.write(body)
        except (BrokenPipeError,ConnectionResetError):pass
    def uid(self):
        cookie=SimpleCookie();cookie.load(self.headers.get('Cookie',''));v=cookie.get('plaza')
        row=v and db.execute('select uid from sessions where token=?',(digest(v.value),)).fetchone()
        return row[0] if row else None
    def do_GET(self):
        name=unquote(urlsplit(self.path).path).lstrip('/') or PAGE
        if name=='world':
            with lock:
                uid=self.uid()
                return self.reply(200,dict(me=uid,players=players(viewer=uid) if uid else []))
        if name not in FILES or not (ROOT/name).is_file():return self.reply(404,{})
        self.reply(200,(ROOT/name).read_bytes(),('application/json' if name.endswith('.json') else 'text/html' if name==PAGE else 'text/css' if name.endswith('.css') else 'text/javascript')+'; charset=utf-8')
    def do_POST(self):
        try:
            if self.headers.get('Origin') and urlsplit(self.headers['Origin']).netloc!=self.headers.get('Host'):return self.reply(403,{})
            if self.headers.get_content_type()!='application/json':return self.reply(415,{})
            n=int(self.headers.get('Content-Length',0))
            if not 0<n<180000:return self.reply(413,{})
            d=json.loads(self.rfile.read(n))
            with lock:self.act(d)
        except (ValueError,TypeError,KeyError,AttributeError) as e:self.reply(400,{'error':str(e)})
    def act(self,d):
        uid=self.uid()
        if self.path in ('/enter','/restore'):
            ip=self.client_address[0];now=time.monotonic();q=attempts.setdefault(ip,deque())
            while q and q[0]<now-60:q.popleft()
            if len(q)>=20:return self.reply(429,{'error':'잠시 후 다시 시도해 주세요.'})
            q.append(now);code=str(d.get('code','')).upper()
            if not re.fullmatch(r'(?=[0-9A-Z]{5}$)(?:[0-9]*[A-Z][0-9]*)',code):raise ValueError('숫자 네 개와 영문 한 글자를 입력해 주세요.')
            row=db.execute('select id from people where code=?',(digest(code),)).fetchone()
            if self.path=='/restore':
                if not row:raise ValueError('본인 확인 코드를 확인해 주세요.')
                uid=row[0]
            else:
                nick=unicodedata.normalize('NFKC',str(d.get('nick','')).strip())
                if not valid_nick(nick):raise ValueError('사용할 수 없는 닉네임입니다.')
                if row:raise ValueError('다른 본인 확인 코드를 선택해 주세요.')
                if db.execute('select 1 from people where nickkey=?',(nickkey(nick),)).fetchone():raise ValueError('이미 사용 중인 닉네임입니다.')
                role=d.get('role')
                if role not in ('bound','cash'):raise ValueError('상태를 선택해 주세요.')
                st=check_stock(d.get('stock',{})) if role=='bound' else None
                slot=db.execute('select coalesce(max(slot)+1,0) from people').fetchone()[0]
                if slot>=len(slots):raise ValueError('자리가 가득 찼습니다.')
                uid=db.execute('insert into people(nick,nickkey,code,role,stock,slot) values(?,?,?,?,?,?)',(nick,nickkey(nick),digest(code),role,json.dumps(st,ensure_ascii=False) if st else None,slot)).lastrowid
            token=secrets.token_urlsafe(32);db.execute('insert into sessions values(?,?)',(digest(token),uid))
            return self.reply(200,dict(me=uid,players=players(viewer=uid)),cookie='plaza='+token+'; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000')
        if not uid:return self.reply(401,{'error':'다시 입장해 주세요.'})
        if self.path=='/react':
            target,emoji,enabled=d.get('target'),d.get('emoji'),d.get('enabled')
            if type(target) is not int or not isinstance(emoji,str) or emoji not in emoji_set or type(enabled) is not bool:
                raise ValueError('이모지를 다시 선택해 주세요.')
            if not db.execute("SELECT 1 FROM people WHERE id=? AND role='bound'",(target,)).fetchone():
                raise ValueError('묶인 페페를 선택해 주세요.')
            if enabled:
                db.execute('INSERT OR IGNORE INTO reactions VALUES(?,?,?)',(target,emoji,uid))
            else:
                db.execute('DELETE FROM reactions WHERE target=? AND emoji=? AND author=?',(target,emoji,uid))
            return self.reply(200,{'ok':True})
        if self.path=='/move':
            row=db.execute('select role from people where id=?',(uid,)).fetchone()
            m=d.get('moving');role=row[0]
            if m is not None:
                mode=m['mode']
                if mode!=('walk' if role=='cash' else 'ghost'):raise ValueError('이동 상태 오류')
                values=[float(m[k]) for k in ('x','z','yaw')]
                if not all(math.isfinite(v) for v in values):raise ValueError('이동 좌표 오류')
                m=dict(zip(('x','z','yaw'),values));m.update(mode=mode)
                for k in ('x','z'):m[k]=max(-99,min(99,m[k]))
            presence[uid]=dict(time=time.monotonic(),moving=m)
            return self.reply(200,dict(me=uid,players=players(set(d.get("known",[])),uid)))
        if self.path=='/leave':
            db.execute('delete from sessions where token=?',(digest(SimpleCookie(self.headers['Cookie'])['plaza'].value),));presence.pop(uid,None)
            return self.reply(200,{},cookie='plaza=; Path=/; Max-Age=0; SameSite=Strict')
        return self.reply(404,{})
ThreadingHTTPServer((args.bind,args.port),Handler).serve_forever()
