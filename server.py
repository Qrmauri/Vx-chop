"""
server.py - Servidor local para VX-CHOP con soporte de API para YouTube Audio
Sirve los archivos estáticos y extrae el stream de audio de YouTube directamente a la MPC.
"""

import os
import sys
import json
import urllib.parse
import urllib.request
import subprocess
from http.server import HTTPServer, SimpleHTTPRequestHandler

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 4173

# Buscar la carpeta dist si existe, sino la actual
ROOT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'dist')
if not os.path.exists(ROOT_DIR):
    ROOT_DIR = os.path.dirname(os.path.abspath(__file__))

def ensure_ytdlp():
    try:
        import yt_dlp
        return True
    except ImportError:
        print("[VX-CHOP] Instalando yt-dlp para extracción de audio de YouTube...")
        try:
            subprocess.check_call([sys.executable, "-m", "pip", "install", "--quiet", "yt-dlp"])
            return True
        except Exception as e:
            print(f"[VX-CHOP] No se pudo instalar yt-dlp: {e}")
            return False

class VxChopHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT_DIR, **kwargs)

    def end_headers(self):
        # Habilitar CORS para Web Audio y Worklets
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', '*')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)

        # Endpoint de búsqueda en YouTube para Crate Digging
        if parsed.path == '/api/yt-search':
            qs = urllib.parse.parse_qs(parsed.query)
            query = qs.get('q', [''])[0]
            
            if not query:
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'error': 'Falta el parámetro de búsqueda q'}).encode())
                return

            if not ensure_ytdlp():
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'error': 'yt-dlp no disponible'}).encode())
                return

            try:
                import yt_dlp
                ydl_opts = {
                    'quiet': True,
                    'no_warnings': True,
                    'extract_flat': True,
                    'skip_download': True,
                }
                with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                    search_res = ydl.extract_info(f"ytsearch12:{query}", download=False)
                    entries = search_res.get('entries', []) or []
                    results = []
                    for item in entries:
                        if item and item.get('id'):
                            dur = item.get('duration')
                            dur_str = f"{int(dur)//60}:{int(dur)%60:02d}" if dur else ""
                            results.append({
                                'id': item.get('id'),
                                'title': item.get('title', 'Sin título'),
                                'duration': dur_str,
                                'uploader': item.get('uploader') or item.get('channel') or '',
                            })

                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'results': results}).encode())
                return
            except Exception as e:
                print(f"[VX-CHOP] Error al buscar en YouTube: {e}")
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'error': str(e)}).encode())
                return
        
        # Endpoint de extracción de audio de YouTube
        if parsed.path == '/api/yt-audio':
            qs = urllib.parse.parse_qs(parsed.query)
            video_id = qs.get('id', [None])[0] or qs.get('url', [None])[0]
            
            if not video_id:
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'error': 'Falta el parámetro id o url'}).encode())
                return

            if not ensure_ytdlp():
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'error': 'yt-dlp no disponible'}).encode())
                return

            try:
                import yt_dlp
                url = video_id if ('http' in video_id) else f"https://www.youtube.com/watch?v={video_id}"
                
                ydl_opts = {
                    'format': 'bestaudio/best',
                    'quiet': True,
                    'no_warnings': True,
                }
                
                with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                    info = ydl.extract_info(url, download=False)
                    stream_url = info.get('url')
                    title = info.get('title', 'YouTube Sample')

                if not stream_url:
                    raise Exception('No se encontró URL de stream')

                # Descargar y enviar el stream de audio al navegador
                req = urllib.request.Request(
                    stream_url,
                    headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
                )
                
                with urllib.request.urlopen(req, timeout=25) as resp:
                    self.send_response(200)
                    self.send_header('Content-Type', 'audio/webm')
                    content_len = resp.headers.get('Content-Length')
                    if content_len:
                        self.send_header('Content-Length', content_len)
                    self.send_header('X-Sample-Title', urllib.parse.quote(title))
                    self.end_headers()

                    # Transmisión por bloques (chunked streaming) para mínimo uso de memoria
                    while True:
                        chunk = resp.read(64 * 1024)
                        if not chunk:
                            break
                        self.wfile.write(chunk)

                print(f"[VX-CHOP] Audio de '{title}' transmitido con éxito.")
                return

            except Exception as e:
                print(f"[VX-CHOP] Error al extraer audio de YouTube: {e}")
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'error': str(e)}).encode())
                return

        return super().do_GET()

if __name__ == '__main__':
    print(f"========================================================")
    print(f"       Servidor VX-CHOP MPC iniciado en puerto {PORT}")
    print(f"       Abre: http://localhost:{PORT}")
    print(f"========================================================")
    server = HTTPServer(('0.0.0.0', PORT), VxChopHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nDeteniendo servidor...")
        server.server_close()
