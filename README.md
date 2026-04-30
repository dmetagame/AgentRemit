# AgentRemit

AgentRemit is an autonomous remittance agent for the Lagos corridor. A sender connects a wallet, sets a recipient, amount, and target USDC/NGN exchange rate, then deploys a 0G-backed agent job that watches live rates and executes when the target is reached.

The product combines wallet onboarding, live FX monitoring, durable agent jobs, 0G Storage memory, Uniswap API quote metadata, Uniswap swap preparation, KeeperHub execution, and 0G Storage receipts into one end-to-end remittance workflow.

## Project Links

- Production app: https://agentremit-gamma.vercel.app
- Repository: https://github.com/dmetagame/AgentRemit

## Submission Description

AgentRemit lets diaspora senders automate stablecoin remittances instead of manually checking rates and timing transfers. The sender configures a remittance agent with a target USDC/NGN rate. The agent creates a durable server-side job, records lifecycle transitions to 0G Storage memory, watches live exchange-rate data, requests a Uniswap quote when the target is reached, submits the execution through KeeperHub, and stores the resulting receipt on 0G Storage.

For the demo, the dashboard shows wallet connection, a live nonzero USDC/NGN rate, auto-generated 0G agent handles, a visible durable job ID, pause/resume/cancel/update-target controls, seeded 0G receipts, and a full live activity feed: job created, watching, rate hit, quote received, KeeperHub job submitted, KeeperHub confirmed, and receipt saved.

## Why It Matters

Remittance senders often care about timing. A small rate movement can materially change the amount family members receive. AgentRemit turns that manual process into a transparent, inspectable agent: the user defines the rule, the agent waits, and every step is surfaced in the UI with receipts.

## Core Features

- Connect wallet with RainbowKit and Wagmi.
- Display live USDC/NGN rates from the rates API.
- Auto-generate 0G agent handles from sender input.
- Create durable agent jobs with Upstash Redis in production and local memory fallback in development.
- Pause, resume, cancel, and update the target rate for an active agent job.
- Record major state transitions to 0G Storage memory: created, watching, rate hit, quote received, execution submitted, confirmed, and receipt saved.
- Trigger immediately when the live rate reaches the configured target.
- Request Uniswap Trading API `/quote` data when `UNISWAP_API_KEY` is configured, with Uniswap v3 contract quoting as a fallback.
- Show before/after quote snapshots, route, slippage, expected output, and execution status in each receipt.
- Submit execution requests through KeeperHub.
- Store remittance receipts on 0G Storage.
- Show seeded and live receipt history in the dashboard.

## Tech Stack

- Next.js 15, React, TypeScript, Tailwind CSS
- RainbowKit, Wagmi, Viem, Ethers
- ENSJS on Sepolia for optional recipient `.eth` resolution
- Uniswap Trading API `/quote`, Uniswap v3 SDK, and UniversalRouter calldata
- KeeperHub Direct Execution API
- 0G Storage Galileo testnet
- Vercel production deployment

## Demo Flow

1. Open the production dashboard.
2. Connect a wallet and confirm the shortened wallet address appears.
3. Confirm the rate tracker shows a live USDC/NGN value.
4. Fill the setup form with a recipient, amount, and target rate below the current rate.
5. Confirm the 0G agent handle preview updates while typing.
6. Deploy the agent.
7. Confirm the durable job panel shows the job ID, job store, and 0G memory transition count.
8. Use pause, resume, cancel, or update-target controls to prove the agent is controllable after deployment.
9. Watch the activity feed for job created, watching, rate hit, quote, KeeperHub execution, receipt storage, and 0G memory updates.
10. Open the receipts table to inspect Uniswap quote snapshots, KeeperHub job ID, transaction hash, and 0G receipt root.

## Production Notes

The deployed app is configured for Sepolia and production Vercel environment variables. Live KeeperHub execution requires the KeeperHub organization behind `KEEPERHUB_API_KEY` to have a configured wallet. Without that wallet, KeeperHub returns:

```text
No wallet configured for this organization. Create a wallet in Settings before executing transactions.
```

For a local end-to-end demo without spending KeeperHub wallet funds, run the app in mock KeeperHub mode.

Privileged write routes require a fresh wallet signature. Agent deployment and
job controls are rejected unless the signed wallet matches the submitted
owner/sender address.

Agent deployment now creates a durable job and returns a `jobId`. The UI
subscribes to `/api/agent/jobs/:jobId/events`, while `/api/agent/worker` advances
queued work. On the current Vercel Hobby deployment, the worker cron is scheduled
daily because Hobby accounts do not allow more frequent cron jobs. For true
production autonomy, run the worker from a Pro Vercel cron or an external
scheduler. Configure Upstash Redis REST variables for production durability;
without them, jobs and receipt indexes fall back to in-memory local mode.

Major agent state transitions are also written to 0G Storage through the agent
memory log. If 0G upload is unavailable, the transition is retained in the job
record with a memory-fallback proof so the demo still shows exactly what would
be persisted.

Uniswap integration uses the Trading API `/quote` endpoint when
`UNISWAP_API_KEY` is set. The quote request uses Sepolia, native ETH input,
USDC output, `EXACT_INPUT`, V3 routing, and 0.50% slippage. The worker keeps a
v3 contract quote fallback for local development or API-key-free demos.

Production execution fails closed when live exchange-rate data is unavailable.
The fallback rate is display-only unless mock/local KeeperHub mode is enabled or
`AGENTREMIT_ALLOW_FALLBACK_RATE_EXECUTION=true` is set explicitly.

## Local Development

Install dependencies:

```bash
npm install
```

Run the development server:

```bash
npm run dev
```

Run a local demo with mocked KeeperHub execution:

```bash
KEEPERHUB_MODE=mock npm run dev
```

Open `http://localhost:3000`.

## Environment Variables

```bash
PRIVATE_KEY=
NEXT_PUBLIC_WALLETCONNECT_ID=
NEXT_PUBLIC_ALCHEMY_SEPOLIA_URL=
EXCHANGE_RATE_API_KEY=
ZEROG_RPC_URL=
ZEROG_INDEXER_URL=
KEEPERHUB_API_KEY=
KEEPERHUB_API_URL=
KEEPERHUB_MODE=
UNISWAP_API_KEY=
UNISWAP_API_BASE_URL=
AGENTREMIT_ALLOW_FALLBACK_RATE_EXECUTION=
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
AGENTREMIT_WORKER_SECRET=
CRON_SECRET=
```

`KEEPERHUB_API_URL` defaults to `https://app.keeperhub.com/api`. Leave `KEEPERHUB_MODE` unset for live KeeperHub execution, or set it to `mock` for local demonstration.

## API Checks

```bash
curl http://localhost:3000/api/rates
curl "http://localhost:3000/api/receipts?agent=sends-ada-home.agentremit.eth"
```

Expected behavior:

- `/api/rates` returns current USDC/NGN JSON with a positive rate.
- `/api/receipts` returns the seeded 0G receipt history for `sends-ada-home.agentremit.eth`.

## Verification

```bash
npm run lint
npx tsc --noEmit
npm run build
```

## AI Usage

AI-assisted development is disclosed in [AI_USAGE.md](./AI_USAGE.md).
