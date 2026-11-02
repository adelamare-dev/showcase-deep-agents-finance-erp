# AGENTS.md — agent/ (Python)

## Scope

Service FastAPI + LangGraph qui expose le graphe `finance_erp_agent` en AG-UI sur `127.0.0.1:8123`. Seul le runtime Next l'appelle (`/api/copilotkit`) ; le navigateur ne touche jamais ce port. Le front vit à la racine (`src/`), pas ici.

## Commandes

- Resynchroniser l'environnement : `uv sync` (déjà lancé par `pnpm install`).
- Serveur de dev : `uv run uvicorn main:app --host 127.0.0.1 --port 8123 --reload`.
- Tests : `uv run pytest -q` — hors ligne : `tests/conftest.py` pose une fausse clé, et le modèle est simulé ou arrêté avant tout appel réseau.
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
- Modèles : tout client Mistral se construit dans `models.py` (identifiants datés, timeout, une seule tentative). L'orchestrateur utilise `_StreamingToolCallMistral` : Mistral livre un appel d'outil en un seul chunk portant `finish_reason`, que `ag_ui_langgraph` ignorerait sans ce redécoupage.
- Le profil de harnais est enregistré sous la clé `mistral` (celle que `ChatMistralAI` déclare) : il retire le système de fichiers virtuel et l'outil `task`. `build_agent()` n'est appelé que depuis `main.py` ; `tests/test_agent_tools.py` verrouille la liste des 9 outils exposés.
- `CopilotKitMiddleware` sérialise déjà les objets `Context` d'AG-UI (copilotkit 0.1.96) : aucun patch de `json.dumps` n'est nécessaire, un test le garde.

↑ Voir `AGENTS.md` à la racine pour les principes de travail, les règles du repo et la vérification.

## Méta — Garder ce fichier vivant

- Une règle périmée est supprimée, pas laissée en place.
- Toute règle ajoutée trace à un fait observé ; sinon `TODO: verify`.
- Ne jamais mettre à jour sans confirmation explicite. Au-delà de 150 lignes, condenser avant d'ajouter.
