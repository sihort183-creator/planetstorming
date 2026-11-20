from email.message import Message
from http import HTTPStatus
import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location("plaza_server", Path(__file__).with_name("광장-서버.py"))
server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server)


class WebRequest(server.Handler):
    def __init__(self, env):
        self.path = env["PATH_INFO"].encode("latin-1").decode("utf-8")
        self.client_address = (env.get("REMOTE_ADDR", ""), 0)
        self.headers = Message()
        for name, value in env.items():
            if name.startswith("HTTP_"):
                self.headers[name[5:].replace("_", "-")] = value
        self.headers["Content-Type"] = env.get("CONTENT_TYPE", "")
        self.headers["Content-Length"] = env.get("CONTENT_LENGTH") or "0"
        self.rfile = env["wsgi.input"]

    def reply(self, status, data, mime="application/json", cookie=None):
        body = data if isinstance(data, bytes) else server.json.dumps(data, ensure_ascii=False).encode()
        headers = [("Content-Type", mime), ("Content-Length", str(len(body))), ("Cache-Control", "no-store")]
        if cookie:
            headers.append(("Set-Cookie", cookie + "; Secure"))
        self.result = (f"{status} {HTTPStatus(status).phrase}", headers, [body])


def application(environ, start_response):
    req = WebRequest(environ)
    method = environ["REQUEST_METHOD"]
    if method == "GET":
        req.do_GET()
    elif method == "POST":
        req.do_POST()
    else:
        req.reply(405, {})
    status, headers, body = req.result
    start_response(status, headers)
    return body
