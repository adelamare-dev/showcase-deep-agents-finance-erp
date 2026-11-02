# AGENTS.md — Deep Agents Finance ERP

> Ce fichier ne contient que ce qui est propre à ce repo. Cible : < 150 lignes.
> Code, commentaires, commits, README, docs et interface en **anglais** ; ce fichier en français.

## Statut

Fork **autonome** du showcase `CopilotKit/examples/showcases/deep-agents-finance-erp` : aucune resynchronisation amont prévue. Repo public de démo (LinkedIn, rendez-vous), piloté en local, puis base d'un futur repo privé. Le succès se mesure à une orchestration **visible, contrôlée par un humain et exacte sur les chiffres** — pas à une absence de panne.

Chantier en cours : l'agent tourne sur **Mistral** (`ministral-14b-2512` pour l'orchestrateur et les sous-agents, `agent/models.py` ; `mistral-small-2603` a un quota de 0 requête/min sur ce compte). `SETUP/` (spec, plan, preuves) est volontairement **hors dépôt** et gitignored : ne rien en citer dans le code, les commits, le README ou l'interface.

## Stack et chemins

| Quoi | Où |
|---|---|
| Web Next 16 (App Router, React 19, Tailwind v4, shadcn) | `src/app`, `src/components`, `src/hooks`, `src/lib`, `src/types` |
| Runtime CopilotKit → agent | `src/app/api/copilotkit/[[...slug]]/route.ts` |
| Chat, outils UI, contexte agent | `src/components/layout/shell.tsx` + `src/hooks/use-*.tsx` |
| Agent FastAPI (`:8123`) | `agent/main.py`, graphe dans `agent/agent.py`, modèles dans `agent/models.py` |
| Prompts, outils, sous-agents | `agent/prompts.py`, `agent/tools.py`, `agent/frontend_tools.py`, `agent/isolated_subagents.py` |
| Données de démo | agent : `agent/erp_store.py` (source), `agent/erp_seed.py`, `GET /api/erp/snapshot` ; web : `src/context/erp-context.tsx` charge ce snapshot (`src/lib/erp-api.ts`, `NEXT_PUBLIC_ERP_API_URL`), les pages le lisent par `useErp()` |
| Dashboards | templates en constantes (`src/content/dashboard-templates.ts`), dashboards enregistrés en `localStorage` (`src/lib/saved-dashboards.ts`, clé versionnée) |
| Postgres | archive non branchée dans `templates/postgres/` (hors `tsconfig` et ESLint) ; lire son README avant tout usage |

## Commandes

- `pnpm install` — installe le web, puis `uv sync` dans `agent/` (postinstall).
- `pnpm dev` — web sur `:3000` et agent sur `:8123`, tous deux en rechargement.
- `pnpm demo` — build de production, puis les deux serveurs sans rechargement. Mode des mesures et des rendez-vous.
- `pnpm build` / `pnpm start` — web seul. `pnpm dev:agent` / `pnpm start:agent` — agent seul.
- `pnpm lint` — ESLint sur le web (`agent/` est ignoré).
- `pnpm test:agent` — pytest dans `agent/`, hors ligne (aucune clé réelle ni appel réseau).
- `cd agent && uv run python scripts/probe_models.py` — sonde les modèles Mistral (statut et quotas `x-ratelimit-*`), sans imprimer la clé.
- `pnpm e2e:build` — assemble `e2e/lib/helpers.js` + `e2e/scenarios/*.js` en `.playwright-mcp/scenarios/` ; on les lance avec l'outil `browser_run_code_unsafe` du plugin Playwright (`filename`), serveurs démarrés au préalable. Pas de `@playwright/test`. Voir `e2e/README.md`.
- Binaires : `pnpm exec <bin>`, jamais `npx`. Python : `uv run`.

Prérequis : Node ≥ 20.9 (`.nvmrc` épingle 24), pnpm 11, uv ≥ 0.11. Aucune base de données requise.

## Règles du repo

- **Source unique de données.** L'agent possède les données (`ErpStore`) et le front les lit par `GET /api/erp/snapshot` : aucune donnée métier dans `src/`. **Aucun chiffre affiché** (carte, graphique, approbation) ne vient du modèle : il choisit un identifiant, le code remplit.
- **Aucun identifiant de spec ou de plan** (`T3`, « ticket », « tâche 4 »…) dans le code, les noms, les commentaires ou les messages imprimés.
- **Identifiants de modèle datés**, jamais `-latest`. `MISTRAL_API_KEY` n'est jamais imprimée, journalisée ni commitée.
- **Dates relatives à aujourd'hui**, jamais codées en dur, dès que le store arrive.
- **Validé en 1280×720** ; pas de travail mobile.
- **Aucun agent ne pousse.** Pas de `--force`, pas de `--hard`, pas de suppression hors de ce que la tâche produit.
- Commits en **Conventional Commits**, sans attribution IA.

## Conventions

- TypeScript `strict`, alias `@/*` → `./src/*`. Client components : `"use client"` en première ligne.
- Classes Tailwind composées par `cn()` (`src/lib/utils.ts`) ; préfixe `cpk:` pour surcharger les composants CopilotKit.
- Python : `from __future__ import annotations`, docstrings en anglais, outils `@tool` de `langchain_core.tools`.
- **Politique de dépendances stricte, des deux côtés.** pnpm (`pnpm-workspace.yaml`) : cooldown de 7 jours, `trustPolicy: no-downgrade`, `blockExoticSubdeps`, `strictDepBuilds`, `audit.level: high`. uv (`agent/pyproject.toml`) : `exclude-newer`, `no-build`, `required-version`, `malware-check`. Une dépendance qui bute sur une règle s'ajoute en exception **exacte et commentée** (`trustPolicyExclude`, `allowBuilds`), jamais en assouplissant la règle.

## Pièges

- **Le web ne démarre pas sans l'agent** : `ErpProvider` n'affiche ses enfants qu'une fois le snapshot chargé (sinon écran de chargement ou message avec Retry). Le CORS de l'agent n'autorise que `FRONTEND_ORIGIN` (défaut `http://localhost:3000`) : changer l'origine du web impose de changer aussi cette variable.
- **`useRenderTool` exige `parameters`** en `@copilotkit/react-core` 1.80.0 : chaque outil front déclare un schéma `zod` permissif décrivant les champs lus. Les cartes n'ont été validées qu'au build et au chargement — le rendu réel reste à prouver.
- **Pas de prop `instructions` sur `CopilotSidebar`** en 1.80.0. Les consignes passent par `useAgentContext` (`shell.tsx`), comme les KPI et la disposition du dashboard.
- **`pnpm lint` est rouge, antérieur à ce chantier** : 6 erreurs, 5 avertissements (`any` dans `use-update-dashboard.tsx`, réaffectation après rendu dans `cash-waterfall-chart.tsx`). `e2e/` et `.playwright-mcp/` sont ignorés (scénarios en expression unique). Ce n'est pas une régression ; à corriger avant la remise finale.
- **`@ag-ui/client` est épinglé à la version exacte de `@copilotkit/runtime`** (1.0.2) : deux copies différentes rendent `HttpAgent` inassignable au runtime (`next build` échoue sur le type). À remonter avec `@copilotkit/*`.
- **`@copilotkit/*` reste en 1.80.0** : la 1.83.0 est refusée par `minimumReleaseAge`. Ne pas forcer la montée, ne pas assouplir le cooldown.
- **Windows `MAX_PATH`** : un clone trop profond casse `agent/.venv` au-delà de 260 caractères. Garder un chemin court.
- **Les sous-agents tournent en threads isolés** (`isolated_subagents.py`) : c'est voulu, ça empêche les événements internes de fuiter dans le flux parent. Ne pas « simplifier » en `subagents=[...]`.
- **`agent/` est invisible pour ESLint** (`eslint.config.mjs` l'ignore) : `pnpm lint` ne dit rien de ce dossier, et un lint vert ne prouve rien côté Python.
- **Un scénario E2E est une seule expression** (`async (page, h) => {...}`) : ni `import`, ni `require`, ni `;` final, car `browser_run_code_unsafe` l'exécute dans une VM sans module. Les helpers viennent de `h`. Barre latérale du chat fermée : toujours « visible » hors écran, `h.open` teste sa position.

## Vérification

Niveau par défaut : **standard**.

- Web : `pnpm build` (vérification des types active) et `pnpm lint` — comparer aux 6 erreurs connues ci-dessus, ne pas en ajouter.
- Agent hors ligne : `cd agent && uv run pytest -q` (aucun appel réseau attendu).
- Bout en bout : `pnpm demo`, puis `GET http://127.0.0.1:8123/health` et la page `http://localhost:3000`.
- Toute mesure live compare à des valeurs **lues dans le store au moment du test**, jamais écrites en dur. Un 429 n'est pas un échec du code : attendre la fenêtre, rejouer, le noter.
- Vérifier chaque API de bibliothèque dans le paquet installé (ou par Context7) avant de l'utiliser : les points marqués « à confirmer » dans les notes ne sont pas acquis.

## Principes de travail

- **Réfléchir avant de coder.** Énoncer les hypothèses ; si plusieurs interprétations existent, les présenter au lieu d'en choisir une en silence. Si quelque chose est flou, s'arrêter et demander.
- **Simplicité d'abord.** Pas de fonctionnalité non demandée, pas d'abstraction pour un usage unique, pas de flexibilité spéculative. Si 200 lignes tiennent en 50, réécrire.
- **Changements chirurgicaux.** Ne pas toucher au code, aux commentaires ou au formatage voisins ; ne pas refactorer ce qui n'est pas cassé ; suivre le style existant. Signaler le code mort, ne pas le supprimer.
- **Exécution pilotée par un objectif.** Transformer chaque tâche en critère vérifiable, avec une étape de vérification par étape du plan ; boucler jusqu'à ce que le critère tienne.

## Méta — Garder ce fichier vivant

- Une règle qui n'est plus vraie est pire que pas de règle : la supprimer dès qu'elle est périmée.
- Deux règles contradictoires font choisir au hasard : à la moindre tension entre deux lignes, en supprimer une.
- Une règle qui ne dit rien d'actionnable est du bruit : la couper.
- Toute règle ajoutée doit tracer à un fait observé ; sinon la marquer `TODO: verify`, et la retirer si la vérification échoue.
- Ne jamais mettre à jour ce fichier sans confirmation explicite. Au-delà de 150 lignes, condenser avant d'ajouter.
