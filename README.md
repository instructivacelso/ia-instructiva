# 🤖 Inteligência Artificial Instructiva

Orquestrador **multi-agente** de WhatsApp em cima da **Evolution API** (não-oficial).
Vários números, cada um com uma IA treinada pra um contexto. Recebe leads das landing
pages por webhook e já puxa a conversa, além de responder mensagens que chegam.

## Como funciona (o fluxo)

```
Lead preenche a landing page (ex: inversor solar)
        │  POST /webhook/lead/solar   { nome, telefone, ... }
        ▼
  IA Instructiva  ──►  agente "solar"  ──►  Evolution (número do solar)  ──►  WhatsApp do lead
        ▲                                                                            │
        └──────────  POST /webhook/evolution  ◄── lead respondeu ───────────────────┘
                     (a mesma IA continua a conversa)
```

Cada **agente** = 1 instância no Evolution = 1 número de WhatsApp + 1 prompt próprio.
Página de inversor solar chama `/webhook/lead/solar`, página de fontes chama
`/webhook/lead/fontes`, e cada uma cai na IA certa.

## Stack

- **Node/Express** (sem framework pesado)
- **Banco JSON flat** em `data/` (mesmo padrão do Instructiva App)
- **OpenAI** (`gpt-4o-mini` por padrão)
- **Evolution API v2**
- Painel de controle próprio em `/painel`

## Rodar local

```bash
npm install
cp .env.example .env   # preencha as chaves
npm start
# painel: http://localhost:3000/painel
```

## Deploy no Railway

1. Suba o repositório no GitHub e conecte no Railway.
2. Railway detecta Node e roda `npm start` sozinho.
3. Em **Variables**, configure:

| Variável | Pra quê |
|---|---|
| `ADMIN_PASSWORD` | senha do usuário **admin** (login: `admin`) no primeiro acesso |
| `PUBLIC_URL` | a URL pública do serviço (ex: `https://ia-instructiva-production.up.railway.app`) |
| `EVOLUTION_URL` | URL do seu servidor Evolution |
| `EVOLUTION_API_KEY` | apikey global do Evolution |
| `OPENAI_API_KEY` | chave da OpenAI (respostas + leitura de imagem) |
| `OPENAI_MODEL` | opcional, padrão `gpt-4o-mini` |
| `GROQ_API_KEY` | opcional — transcrição de áudio (se vazio, usa a OpenAI) |
| `SESSION_SECRET` | opcional — segredo dos tokens de login (senão usa o ADMIN_PASSWORD) |

> As chaves (Evolution/OpenAI/Groq) também dão pra configurar **no painel** (aba Configurações, só admin), sem redeploy.

### Login e usuários
No primeiro acesso, entre com **login `admin`** e a senha do `ADMIN_PASSWORD`. Como admin você:
- cria outros usuários (Celso, Bruno…) na aba **Usuários**;
- vê **todos** os agentes e conversas e mexe nas **Configurações**.

Cada usuário comum só enxerga e mexe **nos próprios agentes e conversas** — conecta o número dele e treina a IA dele, sem ver o dos outros.

### Áudio e imagem
- **Áudio** que o cliente manda é baixado, transcrito (Groq se tiver a chave, senão OpenAI) e a IA responde ao conteúdo. No painel você **ouve o áudio** e vê a transcrição.
- **Imagem** é baixada e "lida" pelo modelo de visão (OpenAI); a descrição entra na conversa pra IA entender, e a imagem aparece no chat (clique amplia).
- Os arquivos ficam em `data/media/` — por isso o **Volume em `/app/data`** também guarda as mídias.

O Railway persiste `data/` se você adicionar um **Volume** montado em `/app/data`
(recomendado, senão os agentes/conversas se perdem em cada deploy).

## Usando o painel

1. **Configurações** → cole URL/key do Evolution e a chave da OpenAI.
2. **Agentes → Novo agente**: dê o nome, a instância (ex: `solar`) e o prompt de treino.
3. No card do agente → **Conectar**: aparece o QR, escaneia com o WhatsApp daquele número.
   (Ao conectar, o webhook do Evolution já é registrado automático.)
4. No card → **Webhook**: copia a URL `/webhook/lead/<instancia>` e cola na landing page.

Pronto: lead entrou → IA puxa conversa → lead responde → IA continua.
Quando quiser, em **Conversas** você desliga a chave "IA respondendo" e assume no lugar dela.

## Endpoints de webhook

```
POST /webhook/lead/:agente     # landing page manda o lead (:agente = id ou nome da instância)
POST /webhook/evolution        # Evolution manda as mensagens recebidas (auto-registrado)
GET  /health                   # healthcheck
```

Corpo do lead (aceita variações de campo):

```json
{ "nome": "João", "telefone": "5511998877665", "interesse": "curso solar" }
```

Campos aceitos pro telefone: `telefone` | `phone` | `whatsapp` | `numero`.
Qualquer campo extra vira contexto pra IA (ex: `cidade`, `valor_conta`, etc).

## Detalhes importantes

- **9º dígito**: pra responder, o sistema reaproveita o JID exato que o Evolution manda
  (elimina o bug do nono dígito). Pra primeiro contato, o número é normalizado em `src/phone.js`.
- **Anti-duplicidade**: se o lead já tem conversa iniciada, um novo POST de lead não dispara de novo.
- **Evolution v1 vs v2**: o cliente está em `src/evolution.js` mirando v2. Se seu servidor
  for v1, os formatos alternativos estão comentados nas funções `enviarTexto` e `setWebhook`.

## Próximas fases (estruturado pra crescer)

- Transcrição de áudio (Groq) e visão de imagem/PDF — hoje mídia é registrada como nota.
- Notificação de escalonamento pra humano.
- Métricas por agente (taxa de resposta, conversão).

## Estrutura

```
server.js              # sobe o Express, carrega .env, monta rotas
src/
  config.js            # mescla .env + settings do painel
  db.js                # persistência JSON flat (escrita atômica)
  phone.js             # normalização BR / 9º dígito
  evolution.js         # cliente Evolution API
  ai.js                # chamada OpenAI
  agents.js            # CRUD de agentes
  conversations.js     # motor de conversa (1º contato + resposta)
  routes/
    webhooks.js        # /webhook/lead + /webhook/evolution
    api.js             # API do painel (protegida por senha)
public/                # painel de controle (index.html, app.js, styles.css)
data/                  # banco (agentes.json, conversas.json, settings.json)
```
