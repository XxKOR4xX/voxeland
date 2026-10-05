#!/usr/bin/env python3
"""deploy_gui.py - GUI para publicar VOXELAND en GitHub Pages.

Uso:
    python tools/deploy_gui.py      (o doble clic en DEPLOY.bat)

Pestañas:
    Estado    arbol de cambios de git, stage, sincronia con origin
    Tests     tools/check*.mjs + comprobacion de rutas (404 / mayusculas)
    Publicar  commit, push (normal o --force) y servidor local
    Pages     estado de los despliegues + enlaces al repo/Acciones/juego

Sin dependencias: solo la stdlib de Python (tkinter) y git/node en el PATH.
"""

import json
import queue
import re
import shutil
import subprocess
import sys
import threading
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path

import tkinter as tk
from tkinter import messagebox, ttk

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parent.parent
PAGES_PORT = 8099
USER_AGENT = "voxeland-deploy-gui"
TESTS = [
    ("Texturas y plantas", "tools/check.mjs"),
    ("Parser .glb", "tools/check-glb.mjs"),
    ("Identidades (vaca)", "tools/check-identidades.mjs"),
]
FUENTES_RUTAS = ["index.html", "game.js", "identidades.js", "touch.js"]
PATRON_RUTA = re.compile(r'"((?:png|models|fonts|css|js|tools)/[^"]+?)"')


# ---------------------------------------------------------------- utilidades
def cmd(args, timeout=180):
    """Ejecuta un comando y devuelve (codigo, salida completa)."""
    try:
        p = subprocess.run(
            args, cwd=ROOT, capture_output=True, text=True,
            encoding="utf-8", errors="replace", timeout=timeout,
        )
        return p.returncode, (p.stdout or "") + (p.stderr or "")
    except FileNotFoundError as e:
        return 127, str(e)
    except subprocess.TimeoutExpired:
        return 124, "tiempo de espera agotado: " + " ".join(args)


def git(*args, timeout=180):
    return cmd(["git", *args], timeout=timeout)


def slug_remoto(url):
    """https://github.com/Usuario/repo.git -> Usuario/repo"""
    u = (url or "").strip().rstrip("/")
    if u.endswith(".git"):
        u = u[:-4]
    m = re.search(r"github\.com[:/]([^/]+/[^/]+)$", u)
    return m.group(1) if m else None


def gh_get(ruta, timeout=20):
    """GET a la API de GitHub; devuelve None si no hay red/token."""
    req = urllib.request.Request(
        "https://api.github.com" + ruta,
        headers={"User-Agent": USER_AGENT, "Accept": "application/vnd.github+json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8"))
    except (urllib.error.URLError, ValueError, OSError):
        return None


def peso(ruta):
    try:
        return ruta.stat().st_size
    except OSError:
        return -1


def formato_peso(b):
    if b < 0:
        return "?"
    for unidad in ("B", "KB", "MB", "GB"):
        if b < 1024 or unidad == "GB":
            return f"{b:.0f} {unidad}" if unidad == "B" else f"{b:.1f} {unidad}"
        b /= 1024


# ---------------------------------------------------------------- interfaz
class DeployGUI(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("VOXELAND · Deploy a GitHub Pages")
        self.geometry("980x720")
        self.minsize(760, 560)
        self.q = queue.Queue()
        self.busy = False
        self.servidor = None
        self.repo = None            # "usuario/repo"
        self.url_pagina = None
        self._estilo()
        self._cabecera()
        self._pestanas()
        self._registro()
        self.after(80, self._bombeo)
        self.actualizar_estado()
        self.after(1500, self.actualizar_pages)

    # ------------------------------------------------------------ estilos
    def _estilo(self):
        st = ttk.Style(self)
        if "clam" in st.theme_names():
            st.theme_use("clam")
        st.configure("TButton", padding=4)
        st.configure("Hdr.TLabel", font=("Segoe UI", 11, "bold"))
        st.configure("Ok.TLabel", foreground="#1a7f37", font=("Segoe UI", 9, "bold"))
        st.configure("Mal.TLabel", foreground="#b42318", font=("Segoe UI", 9, "bold"))
        st.configure("Neu.TLabel", foreground="#57606a")
        self.configure(bg="#f6f8fa")

    def _cabecera(self):
        marco = ttk.Frame(self, padding=(10, 8))
        marco.pack(fill="x")
        self.lbl_repo = ttk.Label(marco, text="repo: …", style="Hdr.TLabel")
        self.lbl_repo.pack(side="left")
        self.lbl_sync = ttk.Label(marco, text="", style="Neu.TLabel")
        self.lbl_sync.pack(side="left", padx=12)
        ttk.Button(marco, text="Actualizar", command=self.actualizar_estado).pack(side="right")
        self.lbl_ver = ttk.Label(marco, text="", style="Neu.TLabel")
        self.lbl_ver.pack(side="right", padx=10)

    def _pestanas(self):
        nb = ttk.Notebook(self)
        nb.pack(fill="both", expand=True, padx=10, pady=(0, 4))
        self.tab_estado = ttk.Frame(nb, padding=8)
        self.tab_tests = ttk.Frame(nb, padding=8)
        self.tab_pub = ttk.Frame(nb, padding=8)
        self.tab_pages = ttk.Frame(nb, padding=8)
        nb.add(self.tab_estado, text=" Estado ")
        nb.add(self.tab_tests, text=" Tests ")
        nb.add(self.tab_pub, text=" Publicar ")
        nb.add(self.tab_pages, text=" Pages ")
        self._pestanas_estado()
        self._pestanas_tests()
        self._pestanas_publicar()
        self._pestanas_pages()

    # -------------------------------------------------------- pestaña Estado
    def _pestanas_estado(self):
        f = self.tab_estado
        barra = ttk.Frame(f)
        barra.pack(fill="x", pady=(0, 6))
        ttk.Button(barra, text="git add -A", command=self.git_add).pack(side="left")
        ttk.Button(barra, text="Quitar del stage", command=self.git_reset).pack(side="left", padx=6)
        ttk.Button(barra, text="Descartar cambios locales", command=self.git_restore).pack(side="left")
        self.lbl_peso = ttk.Label(barra, text="", style="Neu.TLabel")
        self.lbl_peso.pack(side="right")

        cols = ("x", "y", "archivo")
        self.tree = ttk.Treeview(f, columns=cols, show="headings", height=16)
        for c, t, w in (("x", "X", 34), ("y", "Y", 34), ("archivo", "Archivo", 700)):
            self.tree.heading(c, text=t)
            self.tree.column(c, width=w, anchor="w")
        self.tree.tag_configure("stage", background="#dafbe1")
        self.tree.tag_configure("mod", background="#fff8c5")
        self.tree.tag_configure("new", background="#ddf4ff")
        self.tree.tag_configure("del", background="#ffebe9")
        sb = ttk.Scrollbar(f, orient="vertical", command=self.tree.yview)
        self.tree.configure(yscrollcommand=sb.set)
        self.tree.pack(side="left", fill="both", expand=True, pady=(0, 4))
        sb.pack(side="right", fill="y", pady=(0, 4))

        info = ttk.LabelFrame(f, text="Fichero", padding=6)
        info.pack(fill="x")
        self.lbl_info = ttk.Label(info, text="…", style="Neu.TLabel", justify="left")
        self.lbl_info.pack(anchor="w")

    # --------------------------------------------------------- pestaña Tests
    def _pestanas_tests(self):
        f = self.tab_tests
        ttk.Label(f, text="Comprobaciones estaticas del motor (node).", style="Neu.TLabel").pack(anchor="w")
        self.fila_tests = ttk.Frame(f)
        self.fila_tests.pack(fill="x", pady=8)
        self.btns_test = []
        self.lbls_test = []
        for nombre, ruta in TESTS:
            celda = ttk.Frame(self.fila_tests)
            celda.pack(side="left", padx=(0, 10))
            b = ttk.Button(celda, text=nombre, command=lambda r=ruta: self.correr_test(r))
            b.pack()
            self.btns_test.append(b)
            l = ttk.Label(celda, text="pendiente", style="Neu.TLabel")
            l.pack()
            self.lbls_test.append(l)
        ttk.Button(f, text="Ejecutar todos", command=self.correr_todos).pack(anchor="w")

        marco = ttk.LabelFrame(f, text="Comprobaciones de publicacion", padding=6)
        marco.pack(fill="x", pady=(12, 0))
        for texto, accion in (
            ("Rutas referenciadas (existencia + mayusculas)", self.comprobar_rutas),
            ("Archivos prohibidos en git (>100 MB / HORSE)", self.comprobar_prohibidos),
            ("Resumen: que carga el navegador", self.resumen_assets),
        ):
            ttk.Button(marco, text=texto, command=accion).pack(anchor="w", pady=2)

    # ------------------------------------------------------- pestaña Publicar
    def _pestanas_publicar(self):
        f = self.tab_pub
        ttk.Label(f, text="Mensaje del commit:", style="Neu.TLabel").pack(anchor="w")
        self.entry_msg = ttk.Entry(f)
        self.entry_msg.insert(0, "VOXELAND 0.1 Alpha")
        self.entry_msg.pack(fill="x", pady=(2, 8))

        fila = ttk.Frame(f)
        fila.pack(fill="x")
        self.chk_force = tk.BooleanVar(value=False)
        ttk.Checkbutton(fila, text="Forzar push (sobrescribe el historial remoto)",
                        variable=self.chk_force).pack(side="left")
        self.chk_abrir = tk.BooleanVar(value=True)
        ttk.Checkbutton(fila, text="Abrir el juego al publicar",
                        variable=self.chk_abrir).pack(side="left", padx=14)

        botones = ttk.Frame(f)
        botones.pack(fill="x", pady=10)
        ttk.Button(botones, text="Commit", command=self.hacer_commit).pack(side="left")
        ttk.Button(botones, text="Push", command=lambda: self.hacer_push(False)).pack(side="left", padx=6)
        ttk.Button(botones, text="Publicar (commit + push)",
                   command=self.publicar).pack(side="left", padx=6)
        self.btn_force = ttk.Button(botones, text="Forzar push",
                                    command=lambda: self.hacer_push(True))
        self.btn_force.pack(side="left", padx=6)

        srv = ttk.LabelFrame(f, text="Vista previa local (node tools/servir.mjs)", padding=6)
        srv.pack(fill="x", pady=(10, 0))
        self.btn_srv = ttk.Button(srv, text="Arrancar servidor local", command=self.toggle_servidor)
        self.btn_srv.pack(side="left")
        ttk.Button(srv, text="Abrir en el navegador",
                   command=lambda: webbrowser.open(f"http://localhost:{PAGES_PORT}")
                   ).pack(side="left", padx=8)
        self.lbl_srv = ttk.Label(srv, text="detenido", style="Neu.TLabel")
        self.lbl_srv.pack(side="left", padx=8)
        ttk.Label(srv, text="El juego necesita HTTP: file:// no sirve (fetch del .glb).",
                  style="Neu.TLabel").pack(side="left", padx=10)

        nota = ttk.LabelFrame(f, text="Orden tipico", padding=6)
        nota.pack(fill="x", pady=(10, 0))
        ttk.Label(nota, justify="left", style="Neu.TLabel", text=(
            "1) Tests en verde   2) git add -A (pestaña Estado)   "
            "3) Publicar   4) mirar la pestaña Pages")).pack(anchor="w")

    # --------------------------------------------------------- pestaña Pages
    def _pestanas_pages(self):
        f = self.tab_pages
        barra = ttk.Frame(f)
        barra.pack(fill="x", pady=(0, 6))
        ttk.Button(barra, text="Actualizar estado", command=self.actualizar_pages).pack(side="left")
        ttk.Button(barra, text="Abrir repo", command=lambda: self.abrir(
            f"https://github.com/{self.repo}" if self.repo else None)).pack(side="left", padx=6)
        ttk.Button(barra, text="Abrir Actions", command=lambda: self.abrir(
            f"https://github.com/{self.repo}/actions" if self.repo else None)).pack(side="left", padx=6)
        ttk.Button(barra, text="Abrir juego", command=lambda: self.abrir(self.url_pagina)).pack(side="left", padx=6)
        self.lbl_pages = ttk.Label(barra, text="", style="Neu.TLabel")
        self.lbl_pages.pack(side="right")

        cols = ("run", "fecha", "rama", "estado", "resultado")
        self.tree_runs = ttk.Treeview(f, columns=cols, show="headings", height=10)
        for c, t, w in (("run", "#", 50), ("fecha", "Fecha", 150), ("rama", "Rama", 80),
                        ("estado", "Estado", 100), ("resultado", "Resultado", 110)):
            self.tree_runs.heading(c, text=t)
            self.tree_runs.column(c, width=w, anchor="w")
        self.tree_runs.tag_configure("ok", background="#dafbe1")
        self.tree_runs.tag_configure("mal", background="#ffebe9")
        self.tree_runs.tag_configure("espera", background="#fff8c5")
        self.tree_runs.pack(fill="both", expand=True)

        enlaces = ttk.LabelFrame(f, text="Enlaces", padding=6)
        enlaces.pack(fill="x", pady=(8, 0))
        self.lbl_enlaces = ttk.Label(enlaces, text="…", style="Neu.TLabel", justify="left")
        self.lbl_enlaces.pack(anchor="w")

    # ----------------------------------------------------------- registro
    def _registro(self):
        marco = ttk.Frame(self, padding=(10, 0, 10, 8))
        marco.pack(fill="both", expand=False)
        cab = ttk.Frame(marco)
        cab.pack(fill="x")
        ttk.Label(cab, text="Registro", style="Hdr.TLabel").pack(side="left")
        ttk.Button(cab, text="Limpiar", command=self.limpiar_log).pack(side="right")
        self.log = tk.Text(marco, height=10, wrap="word", state="disabled",
                           bg="#0d1117", fg="#c9d1d9", insertbackground="#c9d1d9",
                           font=("Consolas", 9), relief="flat", padx=6, pady=4)
        sb = ttk.Scrollbar(marco, orient="vertical", command=self.log.yview)
        self.log.configure(yscrollcommand=sb.set)
        self.log.pack(side="left", fill="both", expand=True, pady=(2, 0))
        sb.pack(side="right", fill="y", pady=(2, 0))
        self.log.tag_configure("err", foreground="#ff7b72")
        self.log.tag_configure("ok", foreground="#7ee787")

    # ------------------------------------------------------------- utilidades
    def escribir(self, texto, tag=None):
        self.log.configure(state="normal")
        for linea in str(texto).splitlines():
            self.log.insert("end", linea + "\n", tag or ())
        self.log.see("end")
        self.log.configure(state="disabled")

    def limpiar_log(self):
        self.log.configure(state="normal")
        self.log.delete("1.0", "end")
        self.log.configure(state="disabled")

    def ocupado(self, valor):
        self.busy = valor
        estado = "disabled" if valor else "normal"
        for w in self.winfo_children():
            self._aplicar_estado(w, estado)

    def _aplicar_estado(self, widget, estado):
        for hijo in widget.winfo_children():
            if isinstance(hijo, (ttk.Button, ttk.Entry)):
                try:
                    hijo.configure(state=estado)
                except tk.TclError:
                    pass
            elif isinstance(hijo, ttk.Notebook):
                for pestana in hijo.winfo_children():
                    self._aplicar_estado(pestana, estado)
            else:
                self._aplicar_estado(hijo, estado)

    def abrir(self, url):
        if url:
            webbrowser.open(url)
        else:
            messagebox.showinfo("VOXELAND", "Todavia no hay URL (falta el remote o Pages).")

    def en_hilo(self, fn, al_terminar=None, etiqueta="", automatico=False, reintentos=0):
        """fn corre en un hilo; su resultado pasa por _bombeo al hilo de tkinter.

        automatico=True (refresco programado) no abre dialogs: reintenta en 1,5 s.
        """
        if self.busy:
            if automatico:
                if reintentos < 10:
                    self.after(1500, lambda: self.en_hilo(fn, al_terminar, etiqueta, True,
                                                          reintentos + 1))
                return
            messagebox.showinfo("VOXELAND", "Espera a que termine la operacion en curso.")
            return
        self.ocupado(True)
        if etiqueta:
            self.escribir("── " + etiqueta + " " + "─" * max(1, 60 - len(etiqueta)))

        def trabajo():
            try:
                res = fn()
            except Exception as e:  # noqa: BLE001 - se vuelca al registro
                res = f"ERROR inesperado: {e}"
            self.q.put(("fin", res, al_terminar))

        threading.Thread(target=trabajo, daemon=True).start()

    def _bombeo(self):
        try:
            while True:
                item = self.q.get_nowait()
                if item[0] == "log":
                    self.escribir(item[1], item[2] if len(item) > 2 else None)
                elif item[0] == "fin":
                    self.ocupado(False)
                    cb = item[2]
                    if cb:
                        try:
                            cb(item[1])
                        except Exception as e:  # noqa: BLE001 - nunca romper el bucle
                            self.escribir(f"ERROR al actualizar la interfaz: {e}", "err")
        except queue.Empty:
            pass
        self.after(80, self._bombeo)

    def flujo(self, args):
        """Ejecuta un comando en streaming y devuelve (codigo, salida)."""
        salida = []
        try:
            p = subprocess.Popen(
                args, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                text=True, encoding="utf-8", errors="replace", bufsize=1,
            )
            for linea in p.stdout:
                linea = linea.rstrip("\n")
                salida.append(linea)
                self.q.put(("log", "  " + linea))
            p.wait()
            return p.returncode, "\n".join(salida)
        except FileNotFoundError as e:
            return 127, str(e)

    def version_actual(self):
        try:
            m = re.search(r'let version = "([^"]+)"', (ROOT / "game.js").read_text(encoding="utf-8"))
            if m:
                return m.group(1)
        except OSError:
            pass
        return "?"

    # ------------------------------------------------------------- Estado
    def actualizar_estado(self):
        def trabajo():
            rc, remoto = git("remote", "get-url", "origin")
            self.repo = slug_remoto(remoto) if rc == 0 else None
            rc2, rama = git("rev-parse", "--abbrev-ref", "HEAD")
            rc3, corto = git("log", "--oneline", "-1")
            rc4, porc = git("status", "--porcelain")
            rc5, sync = git("rev-list", "--left-right", "--count", "@{u}...HEAD")
            return {
                "rama": rama.strip() if rc2 == 0 else "?",
                "commit": corto.strip() if rc3 == 0 else "?",
                "porc": porc.splitlines() if rc4 == 0 else [],
                "sync": sync.strip().split() if rc5 == 0 else [],
                "remote": remoto.strip() if rc == 0 else "",
            }

        def listo(res):
            if isinstance(res, str):
                self.escribir(res, "err")
                return
            self.lbl_repo.config(text=f"repo: {res['remote'] or '(sin remote)'}   rama: {res['rama']}")
            self.lbl_ver.config(text=f"version del juego: {self.version_actual()}")
            if len(res["sync"]) == 2:
                detras, delante = res["sync"]
                if detras == "0" and delante == "0":
                    self.lbl_sync.config(text="sincronizado con origin/main")
                else:
                    self.lbl_sync.config(text=f"origin: -{detras} / +{delante} commits")
            else:
                self.lbl_sync.config(text="sin rama upstream (haz push)")
            self.lbl_info.config(text=f"Ultimo commit: {res['commit']}")

            for item in self.tree.get_children():
                self.tree.delete(item)
            total = 0
            for linea in res["porc"]:
                if len(linea) < 4:
                    continue
                x, y, ruta = linea[0], linea[1], linea[3:]
                if " -> " in ruta:
                    ruta = ruta.split(" -> ")[-1]
                ruta = ruta.strip('"')
                if x == "?" or y == "?":
                    tag = "new"
                elif y == "D" or x == "D":
                    tag = "del"
                elif x != " ":
                    tag = "stage"
                else:
                    tag = "mod"
                self.tree.insert("", "end", values=(x, y, ruta), tags=(tag,))
                p = ROOT / ruta
                s = peso(p)
                if s > 0:
                    total += s
            if not res["porc"]:
                self.tree.insert("", "end", values=("", "", "(sin cambios: working tree limpio)"))
            self.lbl_peso.config(text=f"cambios locales: {len(res['porc'])} · {formato_peso(total)}")

        self.en_hilo(trabajo, listo, "estado de git", automatico=True)

    def git_add(self):
        def trabajo():
            return self.flujo(["git", "add", "-A"])

        def listo(res):
            if not isinstance(res, tuple):
                self.escribir(str(res), "err")
                return
            rc, _ = res
            self.escribir("git add OK" if rc == 0 else "git add falló", "ok" if rc == 0 else "err")
            self.actualizar_estado()

        self.en_hilo(trabajo, listo, "git add -A")

    def git_reset(self):
        def trabajo():
            return self.flujo(["git", "reset"])

        def listo(res):
            self.actualizar_estado()

        self.en_hilo(trabajo, listo, "git reset")

    def git_restore(self):
        if not messagebox.askyesno(
            "VOXELAND",
            "Se perderan TODOS los cambios locales sin commitear\n"
            "(no afecta a lo ya subido). ¿Continuar?",
        ):
            return

        def trabajo():
            return self.flujo(["git", "restore", "."])

        def listo(res):
            self.actualizar_estado()

        self.en_hilo(trabajo, listo, "git restore .")

    # --------------------------------------------------------------- Tests
    def correr_test(self, ruta, indice=None):
        def trabajo():
            rc, texto = cmd(["node", ruta], timeout=300)
            malas = [l for l in texto.splitlines() if "FALLO" in l or "fallo" in l.lower()]
            ok = texto.rstrip().endswith("todo OK") or (rc == 0 and not malas)
            return rc, ok, malas, texto

        def listo(res, ruta=ruta, indice=indice):
            if isinstance(res, str):
                self.escribir(res, "err")
                return
            rc, ok, malas, texto = res
            nombre = Path(ruta).name
            if ok:
                self.escribir(f"OK   {nombre}", "ok")
                self._marca_test(ruta, True)
            else:
                self.escribir(f"FALLO {nombre} (exit {rc})", "err")
                for l in malas[:20]:
                    self.escribir("  " + l, "err")
                self._marca_test(ruta, False)

        self.en_hilo(trabajo, listo, f"node {ruta}")

    def _marca_test(self, ruta, ok):
        for (nombre, r), lbl in zip(TESTS, self.lbls_test):
            if r == ruta:
                lbl.configure(text="OK" if ok else "FALLO",
                              style="Ok.TLabel" if ok else "Mal.TLabel")

    def correr_todos(self):
        def trabajo():
            resultados = []
            for nombre, ruta in TESTS:
                rc, texto = cmd(["node", ruta], timeout=300)
                malas = [l for l in texto.splitlines() if "FALLO" in l]
                ok = texto.rstrip().endswith("todo OK") or (rc == 0 and not malas)
                resultados.append((nombre, ruta, ok, rc, malas))
            return resultados

        def listo(res):
            if isinstance(res, str):
                self.escribir(res, "err")
                return
            todos_ok = True
            for nombre, ruta, ok, rc, malas in res:
                todos_ok = todos_ok and ok
                self._marca_test(ruta, ok)
                if ok:
                    self.escribir(f"OK   {nombre}", "ok")
                else:
                    self.escribir(f"FALLO {nombre} (exit {rc})", "err")
                    for l in malas[:20]:
                        self.escribir("  " + l, "err")
            self.escribir("TODOS LOS TESTS EN VERDE" if todos_ok else "HAY TESTS EN ROJO",
                          "ok" if todos_ok else "err")

        self.en_hilo(trabajo, listo, "suite completa de tests")

    def comprobar_rutas(self):
        def trabajo():
            referenciadas = set()
            for nombre in FUENTES_RUTAS:
                p = ROOT / nombre
                if not p.exists():
                    continue
                for m in PATRON_RUTA.finditer(p.read_text(encoding="utf-8", errors="replace")):
                    ruta = m.group(1)
                    if ruta.endswith("/") or "+" in ruta or "?" in ruta:
                        continue
                    referenciadas.add(ruta)
            rotas, case = [], []
            for ruta in sorted(referenciadas):
                destino = ROOT / ruta
                if destino.exists():
                    if not coincide_mayusculas(ROOT, ruta):
                        case.append(ruta)
                    continue
                # prefijos dinamicos: game.js monta "libro_" + tono + "_" + papel
                directorio = destino.parent
                prefijo = destino.name
                if (prefijo and directorio.exists() and
                        any(f.name.startswith(prefijo) for f in directorio.iterdir())):
                    continue
                rotas.append(ruta)
            return referenciadas, rotas, case

        def listo(res):
            if isinstance(res, str):
                self.escribir(res, "err")
                return
            ref, rotas, case = res
            if not rotas and not case:
                self.escribir(f"rutas OK: {len(ref)} referenciadas, todas existen con el caso exacto", "ok")
            else:
                for r in rotas:
                    self.escribir(f"404 probable: {r}", "err")
                for r in case:
                    self.escribir(f"caso distinto al disco (Pages es Linux): {r}", "err")

        self.en_hilo(trabajo, listo, "comprobacion de rutas")

    def comprobar_prohibidos(self):
        def trabajo():
            rc, lista = git("ls-files", "-z")
            problemas = []
            if rc == 0:
                for ruta in [x for x in lista.split("\0") if x]:
                    p = ROOT / ruta
                    s = peso(p)
                    if s > 90 * 1024 * 1024:
                        problemas.append(f"{ruta} = {formato_peso(s)} (>90 MB, git lo rechaza)")
                    elif ruta.endswith("HORSE_REAL.glb"):
                        problemas.append(f"{ruta} no deberia estar indexado")
            rc2, ignorados = git("check-ignore", "-v", "models/HORSE_REAL.glb")
            return problemas, rc2 == 0

        def listo(res):
            if isinstance(res, str):
                self.escribir(res, "err")
                return
            problemas, ignorado = res
            for p in problemas:
                self.escribir(p, "err")
            if not problemas:
                self.escribir("sin archivos prohibidos en el index", "ok")
            self.escribir("HORSE_REAL.glb esta en .gitignore" if ignorado
                          else "AVISO: HORSE_REAL.glb NO esta ignorado",
                          "ok" if ignorado else "err")

        self.en_hilo(trabajo, listo, "archivos prohibidos")

    def resumen_assets(self):
        def trabajo():
            refs = {}
            for nombre in FUENTES_RUTAS:
                p = ROOT / nombre
                if p.exists():
                    refs[nombre] = len(PATRON_RUTA.findall(p.read_text(encoding="utf-8", errors="replace")))
            rc, ls = git("ls-files")
            n = len([x for x in ls.splitlines() if x])
            return refs, n

        def listo(res):
            if isinstance(res, str):
                self.escribir(res, "err")
                return
            refs, n = res
            self.escribir(f"ficheros en el repo: {n}", "ok")
            for k, v in refs.items():
                self.escribir(f"  {k}: {v} rutas de recurso referenciadas")

        self.en_hilo(trabajo, listo, "resumen de assets")

    # ----------------------------------------------------------- Publicar
    def hacer_commit(self):
        msg = self.entry_msg.get().strip()
        if not msg:
            messagebox.showinfo("VOXELAND", "Escribe un mensaje de commit.")
            return

        def trabajo():
            rc_a, _ = self.flujo(["git", "add", "-A"])
            if rc_a != 0:
                return 1, "git add fallo"
            return self.flujo(["git", "commit", "-m", msg])

        def listo(res):
            if not isinstance(res, tuple):
                self.escribir(str(res), "err")
                return
            rc, texto = res
            self.escribir("commit creado" if rc == 0 else "commit falló",
                          "ok" if rc == 0 else "err")
            self.actualizar_estado()

        self.en_hilo(trabajo, listo, "commit")

    def hacer_push(self, forzar):
        args = ["git", "push", "-u", "origin", "HEAD"]
        if forzar:
            args.append("--force")

        def trabajo():
            return self.flujo(args)

        def listo(res):
            if not isinstance(res, tuple):
                self.escribir(str(res), "err")
                return
            rc, texto = res
            if rc == 0:
                self.escribir("push OK: el remoto esta actualizado", "ok")
                self.actualizar_estado()
                self.after(1200, self.actualizar_pages)
                if self.chk_abrir.get() and self.url_pagina:
                    self.after(2500, lambda: self.abrir(self.url_pagina))
            else:
                self.escribir("push fallo (¿credenciales? ¿rama protegida?)", "err")

        self.en_hilo(trabajo, listo, "push --force" if forzar else "push")

    def publicar(self):
        msg = self.entry_msg.get().strip() or "VOXELAND"
        fuerza = self.chk_force.get()

        def trabajo():
            rc_a, out_a = self.flujo(["git", "add", "-A"])
            if rc_a != 0:
                return 1, "git add fallo"
            rc_c, out_c = cmd(["git", "commit", "-m", msg])
            if rc_c != 0 and "nothing to commit" not in out_c:
                self.q.put(("log", out_c, "err"))
                return rc_c, "commit fallo"
            args = ["git", "push", "-u", "origin", "HEAD"] + (["--force"] if fuerza else [])
            return self.flujo(args)

        def listo(res):
            rc = res[0] if isinstance(res, tuple) else 1
            if rc == 0:
                self.escribir("PUBLICADO: esperando el despliegue de Pages…", "ok")
                self.actualizar_estado()
                self.after(1500, self.actualizar_pages)
                if self.chk_abrir.get() and self.url_pagina:
                    self.after(6000, lambda: self.abrir(self.url_pagina))
            else:
                self.escribir("la publicacion fallo (mira el registro)", "err")

        self.en_hilo(trabajo, listo, "commit + push")

    def toggle_servidor(self):
        if self.servidor and self.servidor.poll() is None:
            self.servidor.terminate()
            self.servidor = None
            self.btn_srv.configure(text="Arrancar servidor local")
            self.lbl_srv.configure(text="detenido", style="Neu.TLabel")
            self.escribir("servidor local detenido")
            return
        if not shutil.which("node"):
            messagebox.showerror("VOXELAND", "No hay node en el PATH: instala nodejs.org")
            return
        try:
            self.servidor = subprocess.Popen(
                ["node", str(ROOT / "tools" / "servir.mjs"), str(PAGES_PORT)],
                cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )
        except OSError as e:
            messagebox.showerror("VOXELAND", f"No se pudo arrancar: {e}")
            return
        self.btn_srv.configure(text="Detener servidor local")
        self.lbl_srv.configure(text=f"activo en :{PAGES_PORT}", style="Ok.TLabel")
        self.escribir(f"servidor local en http://localhost:{PAGES_PORT}", "ok")

    # -------------------------------------------------------------- Pages
    def actualizar_pages(self):
        def trabajo():
            if not self.repo:
                rc, remoto = git("remote", "get-url", "origin")
                self.repo = slug_remoto(remoto) if rc == 0 else None
            if not self.repo:
                return None
            info = gh_get(f"/repos/{self.repo}")
            runs = gh_get(f"/repos/{self.repo}/actions/runs?per_page=8")
            return {"info": info, "runs": runs}

        def listo(res):
            if not isinstance(res, dict):
                self.lbl_pages.config(text="sin remote de GitHub configurado")
                return
            info, runs = res["info"], res["runs"]
            if info:
                usuario, repo = self.repo.split("/")
                self.url_pagina = f"https://{usuario.lower()}.github.io/{repo.lower()}/"
                self.lbl_enlaces.config(text=(
                    f"Juego:  {self.url_pagina}\n"
                    f"Repo:   https://github.com/{self.repo}\n"
                    f"Pages:  https://github.com/{self.repo}/pages\n"
                    f"Tamano: {formato_peso(info.get('size', 0) * 1024)} en el repo"
                ))
            for item in self.tree_runs.get_children():
                self.tree_runs.delete(item)
            if runs and runs.get("workflow_runs"):
                for r in runs["workflow_runs"][:8]:
                    conc = r.get("conclusion") or "-"
                    tag = ("ok" if conc == "success" else
                           "mal" if conc == "failure" else "espera")
                    self.tree_runs.insert("", "end", values=(
                        r.get("run_number"),
                        (r.get("created_at") or "")[:16].replace("T", " "),
                        r.get("head_branch"),
                        r.get("status"),
                        conc,
                    ), tags=(tag,))
                ultimo = runs["workflow_runs"][0]
                conc = ultimo.get("conclusion") or ultimo.get("status")
                self.lbl_pages.config(
                    text=f"ultimo run #{ultimo.get('run_number')}: {conc}",
                    style="Ok.TLabel" if conc == "success" else "Mal.TLabel",
                )
            else:
                self.lbl_pages.config(text="sin runs (¿Actions desactivado?)", style="Mal.TLabel")

        self.en_hilo(trabajo, listo, "estado de GitHub Pages", automatico=True)


def coincide_mayusculas(raiz, ruta):
    """True si cada segmento existe EXACTAMENTE igual en disco (Pages=Linux)."""
    actual = raiz
    for segmento in ruta.replace("\\", "/").split("/"):
        try:
            hijos = [h.name for h in actual.iterdir()]
        except OSError:
            return False
        if segmento not in hijos:
            return False
        actual = actual / segmento
    return True


def main():
    app = DeployGUI()
    app.escribir("VOXELAND deploy GUI lista. Orden: Estado -> Tests -> Publicar -> Pages.")
    if not shutil.which("git"):
        app.escribir("AVISO: no se encuentra git en el PATH", "err")
    if not shutil.which("node"):
        app.escribir("AVISO: no se encuentra node en el PATH (los tests y el servidor no corren)", "err")
    app.mainloop()


if __name__ == "__main__":
    main()
