# AGENTS.md — agent/ (Python)

## Scope

Service FastAPI + LangGraph qui expose le graphe `finance_erp_agent` en AG-UI sur `127.0.0.1:8123`. Seul le runtime Next l'appelle (`/api/copilotkit`) ; le navigateur ne touche jamais ce port. Le front vit à la racine (`src/`), pas ici.

## Commandes

- Resynchroniser l'environnement : `uv sync` (déjà lancé par `pnpm install`).
- Serveur de dev : `uv run uvicorn main:app --host 127.0.0.1 --port 8123 --reload`.
- Tests : `uv run pytest -q` — rouge aujourd'hui pour une raison connue (voir `AGENTS.md` à la racine).
- Ajouter une dépendance : `uv add <pkg>`, puis vérifier que `exclude-newer`, `no-build` et `malware-check` de `pyproject.toml` ne la refusent pas. Une exception se justifie, ne s'assouplit pas.

## Conventions

- `load_dotenv()` en tête de module, **avant** tout import qui lit l'environnement (`main.py`, `agent.py`).
- Un module de domaine par rôle : `tools.py` (données, `research_tools` / `projections_tools`), `frontend_tools.py` (UI `ui_tools` + HITL `hitl_tools`), `isolated_subagents.py` (`do_research` / `do_projections`).
- La docstring d'un `@tool` est la description vue par le modèle : elle est en anglais, et la modifier change le comportement de l'agent.
- Prompts en constantes majuscules dans `prompts.py` ; aucun identifiant de spec ni de plan dans le texte envoyé au modèle.

## Frontières

- Les modules s'importent **à plat** (`from tools import research_tools`) : ils ne résolvent que si le processus démarre avec `agent/` comme répertoire courant. Lancer `uv run …` depuis `agent/`, jamais depuis la racine.
- `agent/` n'est couvert ni par ESLint ni par tsconfig : `pnpm lint` et `pnpm build` ne disent rien de ce dossier.
- Les sous-agents tournent dans un `ThreadPoolExecutor` **par conception** : les callbacks LangChain ne traversent pas la frontière de thread, ce qui empêche les événements internes de fuiter dans le chat. Ne pas les remplacer par `subagents=[...]`.
- `MemorySaver` est le checkpointer : l'état ne survit pas au redémarrage du serveur, et c'est voulu pour la démo.
- Le monkey-patch de `json.dumps` (`agent.py`) contourne la sérialisation des objets `Context` d'AG-UI. Il est temporaire : ne pas l'étendre.

↑ Voir `AGENTS.md` à la racine pour les principes de travail, les règles du repo et la vérification.

## Méta — Garder ce fichier vivant

- Une règle périmée est supprimée, pas laissée en place.
- Toute règle ajoutée trace à un fait observé ; sinon `TODO: verify`.
- Ne jamais mettre à jour sans confirmation explicite. Au-delà de 150 lignes, condenser avant d'ajouter.
