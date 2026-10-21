# repo-search

[English](README.md) · **Español**

Un "Google de repositorios": encuentra **alternativas gratuitas y de código abierto** a cualquier programa, o **herramientas y plugins según lo que hacen**. Escribe en inglés o en español: las búsquedas en español se traducen al inglés sin conexión, sin IA ni claves de API.

**Web:** https://inigo99.github.io/repo-search/

| Escribes | Busca |
|---|---|
| `Adobe Acrobat` | alternativas open source a Adobe Acrobat (editor de PDF) |
| `alternativa gratuita a Photoshop` | alternativas a Photoshop (editor de imágenes) |
| `plugin de obsidian para calendario` | `plugin obsidian calendar` |
| `gestor de contraseñas autoalojado` | `password manager self-hosted` |

## Funciones

- **Filtros por plataforma:** Windows, macOS y Linux (escritorio); Android e iOS (móvil). Puedes marcar varias y verás los resultados que funcionan en cualquiera de ellas.
- **Ordenar:** por coincidencia, por estrellas o por actualización más reciente.
- **Pestaña Saved:** guarda cualquier resultado en una o varias categorías que tú creas (p. ej. *Herramientas PDF*, *Trabajo*). Se guardan en tu navegador; usa **Export / Import** para pasarlos a otro dispositivo.
- **Búsquedas para compartir:** la URL guarda la búsqueda, las plataformas y el orden (p. ej. `?q=editor+pdf&p=windows,linux&sort=stars`).

## Cómo funciona

1. **Interpretación de la búsqueda** (`core.js`): quita acentos, traduce palabras y expresiones del español con `data/es-en.json` y detecta programas comerciales conocidos con `data/apps.json` (p. ej. *Acrobat → pdf editor*).
2. **Resultados curados** de `data/index.json` (unos 3.000 proyectos), sacados de
   [awesome-oss-alternatives](https://github.com/RunaCapital/awesome-oss-alternatives),
   [open-source-alternatives (btw)](https://github.com/btw-so/open-source-alternatives),
   [instead-of](https://github.com/flick9000/instead-of),
   [awesome-selfhosted](https://github.com/awesome-selfhosted/awesome-selfhosted),
   [awesome-open-source-saas-alternatives](https://github.com/Anil-matcha/awesome-open-source-saas-alternatives) y
   [open-source-alternatives (OpenAlternative)](https://github.com/piotrkulpinski/open-source-alternatives).
   Cada repo se completa con estrellas, fecha de actualización y **plataformas**, detectadas a partir de los archivos de su último release (`.exe` → Windows, `.dmg` → macOS, `.AppImage`/`.deb` → Linux, `.apk` → Android, `.ipa` → iOS) y de sus topics.
3. **Búsqueda en vivo en GitHub** con la API de búsqueda de GitHub; si una búsqueda larga no da resultados, reintenta con menos palabras. Con filtros de plataforma, cada plataforma se busca por separado (GitHub no tiene filtro de plataforma).

La página es estática (GitHub Pages). Una GitHub Action regenera el índice cada lunes.

## Token de GitHub (opcional, recomendado)

Sin token, GitHub permite unas **10 búsquedas por minuto** por IP. Con varios filtros de plataforma se hace una búsqueda por plataforma, así que el límite se agota rápido. Un token personal lo sube a 30 por minuto y **no necesita ningún permiso**.

### 1. Crear el token

1. Inicia sesión en GitHub y abre **[Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token](https://github.com/settings/personal-access-tokens/new)**.
2. **Token name:** `repo-search`.
3. **Expiration:** la que prefieras (p. ej. 1 año). Cuando caduque, repite estos pasos.
4. **Repository access:** deja **Public repositories (read-only)**.
5. **Permissions:** no añadas ninguno. Para buscar repositorios públicos no hace falta.
6. Pulsa **Generate token** y cópialo (empieza por `github_pat_`). GitHub solo lo muestra una vez.

### 2. Añadirlo a la web

1. Abre https://inigo99.github.io/repo-search/
2. Baja al final de la página y despliega **GitHub token (optional)**.
3. Pega el token y haz clic fuera del campo. Se guarda automáticamente.

El token se guarda solo en tu navegador (`localStorage`) y solo se envía a `api.github.com`. Hay que ponerlo una vez en cada navegador o dispositivo.

### 3. Añadirlo a la CLI o a la skill de IA

Define la variable de entorno `GITHUB_TOKEN` antes de ejecutar la CLI:

```bash
# macOS / Linux
export GITHUB_TOKEN=github_pat_xxx
```

```powershell
# Windows PowerShell
$env:GITHUB_TOKEN = "github_pat_xxx"
```

### Consejos

- No subas el token a ningún repositorio ni lo pegues en webs de las que no te fíes, aunque no tenga permisos.
- Para revocarlo, ve a **Settings → Developer settings → Fine-grained tokens** y borra `repo-search`.
- Si ves *"GitHub rate limit reached"*, espera un minuto o añade o renueva el token.

## Uso

- **Web:** abre la web, o sírvela en local con `python3 -m http.server` y entra en http://localhost:8000
- **CLI (Node 18+):**
  ```bash
  node cli.js "alternativa a Adobe Acrobat"
  node cli.js "editor de vídeo" --platform windows,linux --sort stars --limit 5
  node cli.js "notas" --platform android --json
  ```
- **Skill de IA:** copia `skill/repo-search/` en tu carpeta de skills (p. ej. `~/.claude/skills/`). El agente ejecuta la CLI y resume los resultados.

## Desarrollo

```bash
GITHUB_TOKEN=github_pat_xxx python3 scripts/build_index.py   # regenera data/index.json (con token añade estrellas y plataformas)
node test.js                                                 # tests sin conexión
```

Para mejorar los resultados, añade palabras en español a `data/es-en.json` o programas a `data/apps.json` (`"nombre del programa": "what it does"`).

## Limitaciones

- Las plataformas de los proyectos curados salen de los archivos de release y de los topics; los proyectos sin releases ni topics (o enlazados solo por su web) se ocultan cuando hay un filtro de plataforma activo.
- En los resultados de GitHub, la plataforma se busca como palabra en el nombre, la descripción o los topics del repo.
- La traducción es palabra a palabra con un diccionario; las palabras en español que no conoce se buscan tal cual.
- Los repos guardados son por navegador. Expórtalos antes de borrar los datos del navegador.

## Licencia

MIT
