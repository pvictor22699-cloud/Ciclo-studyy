# Ciclo Study

Ciclo de estudos com repetição espaçada — o mesmo motor que rodava em arquivo
HTML solto, agora com login, banco de verdade e sincronização entre
dispositivos.

**A lógica pedagógica não foi reescrita.** `server/engine/engine.js` é o
`engine.js` já validado (os 27 testes), byte a byte. O que mudou é só *de onde
vem* e *pra onde vai* o `state`: antes `localStorage`, agora uma coluna JSONB no
Postgres.

```
navegador  ──HTTP──►  API fina  ──►  engine.js (intocado)
(public/)             (server/)      ▲
                          │          └── state carregado do banco
                          └──────────►   state gravado de volta
                                         (Supabase / Postgres)
```

---

## Como rodar agora, sem Supabase

```bash
npm start          # http://localhost:3000
```

Sobe a API + o front com um backend em memória e dois logins prontos:

| papel     | e-mail                  | senha         | onde entrar        |
|-----------|-------------------------|---------------|--------------------|
| aluno     | `kaleu@ciclo.local`     | `kaleu123`    | `/`                |
| professor | `professor@ciclo.local` | `professor123`| `/professor.html`  |

Tudo se perde quando o processo morre — é pra desenvolver e testar.

```bash
npm test           # 60 testes (motor, API, painel do professor, front)
npm run test:e2e   # testes de interface, precisa de playwright (opcional)
```

---

## Schema do banco

`supabase/migrations/0001_init.sql` cria:

| tabela | o que guarda |
|---|---|
| `profiles` | 1:1 com `auth.users`. Campo `role`: `aluno` ou `professor`. Criado por trigger no signup. |
| `students` | **um ciclo de estudo**. `seed` (JSONB) = o `data.js` daquele aluno; `state` (JSONB) = o blob do motor, no mesmo formato do `localStorage`; `state_version` = contador pra concorrência entre dispositivos. |
| `professor_students` | vínculo N:N professor → aluno. O professor só enxerga quem está aqui. |
| `state_snapshots` | cópia do `state` anterior a cada gravação (últimos 50 por aluno). Rede de segurança: o `state` é sobrescrito inteiro. |
| `completions` | cada meta concluída vira uma linha (data, matéria, tópico, etapa, horas). É o `state.log` achatado, pra relatório do professor sem abrir o JSONB. |

Duas decisões que valem explicar:

**Por que o `state` fica num JSONB e não normalizado em tabelas?**
Porque o motor lê e escreve esse objeto inteiro. Normalizar `topics`/`steps` em
tabelas obrigaria a reescrever `computeDay`, `completeItem` e companhia — que é
exatamente o que não se quer mexer. A tabela `completions` cobre a parte
consultável (relatórios, gráficos), sem tocar no motor.

**Por que `state_version`?**
Aluno abre no celular e no notebook. Cada gravação manda a versão que leu; se
alguém gravou no meio, a API responde **409** e o front recarrega em vez de
sobrescrever silenciosamente o dia do outro dispositivo.

RLS está ligado em todas as tabelas (aluno vê o dele; professor vê os
vinculados). A API roda com a `service_role` e faz a autorização em código — as
policies são defesa em profundidade, caso um dia o front fale direto com o
PostgREST.

---

## API

Autenticação: `Authorization: Bearer <access_token>` obtido no login.

### Aluno

| método | rota | o que faz |
|---|---|---|
| `POST` | `/api/auth/login` | `{ email, password }` → tokens + `{ role, studentId }` |
| `POST` | `/api/auth/refresh` | `{ refresh_token }` → nova sessão |
| `POST` | `/api/auth/logout` | encerra a sessão |
| `GET` | `/api/me` | perfil + ciclo vinculado |
| `GET` | `/api/today` | monta o dia (`computeDay`) e devolve as metas com rótulo, instrução, matéria, horas e se já foi feita |
| `POST` | `/api/complete` | `{ itemId, expectedVersion? }` → conclui (`completeItem`) e devolve o dia atualizado |
| `POST` | `/api/extra` | `{ topicId, minutes }` → `requestExtra` (regras do motor: só depois do Estudo 2, 1x por tópico, teto 120 min) |
| `GET` | `/api/progress` | `progressStats` + situação de cada tópico |
| `GET` | `/api/projection?days=21` | `project()` — simulação, não grava nada |
| `PATCH` | `/api/config` | `{ limit?, durations? }` — limite de horas por dia |

`itemId` é o identificador estável de uma meta do dia (`step:T001:E1`,
`extra:T001`, `per:3`, `solido:PT`). Vem do `GET /today` e é o que o
`POST /complete` espera — o cliente não inventa refs.

### Professor

| método | rota | o que faz |
|---|---|---|
| `GET` | `/api/professor/students` | lista de alunos vinculados com % de progresso, ofensiva, horas, dia de hoje e tempo sem estudar |
| `GET` | `/api/professor/students/:id` | detalhe: progresso por matéria, tópicos, dia de hoje, últimas conclusões |
| `POST` | `/api/professor/students` | cria aluno (`{ name, email, password, seed?, timezone? }`), o ciclo dele e o vínculo |
| `POST` | `/api/professor/students/:id/extra` | pede Estudo Extra pro aluno |
| `POST` | `/api/professor/students/:id/link` | vincula um ciclo já existente |

O painel do professor **só lê**: ele monta o dia numa cópia do `state`, então
abrir a tela de um aluno nunca altera o ciclo dele (tem teste pra isso).

Erros saem como `{ error, message }` com status HTTP: `400` entrada inválida,
`401` sem sessão, `403` sem permissão, `404` não existe, `409` versão
desatualizada.

---

## Interface

- `public/index.html` — app do aluno: **Hoje** (metas com instrução do motor,
  marcação de atrasada, ofensiva), **Progresso** (por matéria e por tópico, com
  a régua E1 → E2 → RA → Q1 → Q2 → Q3 → QE), **Próximos dias** (projeção) e
  **Ajustes** (limite diário).
- `public/professor.html` — painel: lista de alunos com % e alerta de quem
  sumiu, detalhe do aluno, cadastro de aluno novo, pedido de Estudo Extra.

Mesma linguagem visual do app standalone (Syne + DM Sans, fundo escuro, acento
vermelho) — o CSS saiu de `index.html` e virou `public/styles.css`.
`public/js/view-model.js` guarda as funções puras de formatação, testadas em
`tests/view-model.test.js`.

O `index.html` da raiz é o app antigo do CFO Bombeiros, intocado.

---

## Ligar no Supabase (passos que são seus)

1. Criar o projeto em supabase.com (região mais perto: `sa-east-1`).
2. SQL Editor → colar `supabase/migrations/0001_init.sql` → Run.
3. Authentication → Providers → Email: ligar, e **desligar "Confirm email"**
   enquanto os logins forem criados por você.
4. Settings → API: copiar `URL`, `anon key` e `service_role key`.
5. Preencher o `.env` (veja `.env.example`):

   ```
   BACKEND=supabase
   SUPABASE_URL=...
   SUPABASE_ANON_KEY=...
   SUPABASE_SERVICE_ROLE_KEY=...
   ALLOW_TODAY_OVERRIDE=false
   ```

6. Criar professor + aluno:

   ```bash
   node scripts/seed-supabase.js \
     --professor victor@exemplo.com --professor-senha "..." \
     --aluno kaleu@exemplo.com --aluno-senha "..." --nome Kaleu \
     --seed caminho/para/seed.json      # opcional: a lista real de tópicos
   ```

7. `npm start` e entrar.

> A `service_role key` **nunca** vai pro navegador. Ela só existe no servidor —
> por isso o login passa pela API em vez do front falar direto com o Supabase.

### Deploy (Vercel)

`vercel.json` já está pronto:

- `outputDirectory: public` — o front sai de `public/`, **não** da raiz (senão a
  Vercel serviria o `index.html` antigo do CFO Bombeiros).
- `api/[...path].js` — rota catch-all: atende todo `/api/*` com o mesmo handler
  do servidor local, sem rewrite nenhum.
- `includeFiles: server/engine/*.js` — obrigatório. O `loader.js` lê o
  `engine.js` com `fs.readFileSync` em runtime; sem isso a Vercel não empacota o
  arquivo e a função quebra com ENOENT. `tests/vercel-adapter.test.js` segura
  essa regressão.

`GET /api/health` é o diagnóstico: `{"ok":true,...}` quer dizer config sã;
`{"ok":false,"problems":[...]}` nomeia a variável errada (chave copiada com a
máscara da tela, espaço nas pontas, valor vazio). Com config quebrada as demais
rotas respondem 503 com a mesma lista, em vez de estourar lá dentro do `fetch`.

As variáveis de ambiente **não** vêm do `.env` (ele é gitignored e nunca sai da
sua máquina): recadastre `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `BACKEND=supabase` e `ALLOW_TODAY_OVERRIDE=false`
no painel do projeto, em Settings → Environment Variables.

Netlify funciona igual com um `netlify.toml` apontando `/api/*` pra uma
function.

---

## Trocar a lista de tópicos (quando a real chegar)

O `seed` de cada aluno é uma coluna do banco, não código:

```json
{
  "subjects":    [{ "id": "PT", "name": "Português", "color": "#2DD4BF", "weight": 1.4 }],
  "subjectQueue": [{ "id": "INFO", "name": "Informática", "color": "#4f8ef7", "weight": 1 }],
  "topicsSeed":  [{ "subj": "PT", "entry": "novo", "name": "Crase" }]
}
```

`weight` é a dificuldade percebida pelo professor (peso na intercalação e na
rotação da periódica). `entry` é `novo` (Estudo 1 → … → Questões Erradas) ou
`revisao` (entra direto em Q1). Passe o arquivo em `--seed` no script, ou o
campo `seed` no `POST /api/professor/students`.

Trocar a semente de um aluno **que já começou** reinicia o ciclo dele — o
`state` é montado a partir dela. Ainda não há migração de tópicos em ciclo
andando; se for preciso, dá pra escrever depois.

---

## Estrutura

```
server/
  engine/engine.js        ← o motor original, INTOCADO
  engine/loader.js        ← injeta a semente do aluno (um ENGINE por aluno)
  engine/seed-kaleu.js    ← semente padrão (o antigo data.js)
  lib/service.js          ← carrega state → chama o motor → grava state
  lib/repo-supabase.js    ← Postgres via PostgREST (sem dependências)
  lib/repo-memory.js      ← mesmo contrato, em RAM (dev e testes)
  lib/auth-*.js           ← Supabase Auth / auth falso de teste
  app.js                  ← rotas
public/                   ← front do aluno e do professor
supabase/migrations/      ← schema + RLS
scripts/seed-supabase.js  ← cria professor, aluno e ciclo
tests/                    ← 60 testes + e2e opcional
index.html                ← app antigo (CFO Bombeiros), preservado
```

Sem dependências de runtime: só Node 20+.
