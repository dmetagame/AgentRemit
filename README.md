# AgentRemit

AgentRemit is an autonomous remittance agent for the Lagos corridor. A sender connects a wallet, sets a recipient, amount, and target USDC/NGN exchange rate, then deploys an ENS-backed agent that watches live rates and executes when the target is reached.

The product combines wallet onboarding, live FX monitoring, ENS agent identity, Uniswap quote and swap preparation, KeeperHub execution, and 0G Storage receipts into one end-to-end remittance workflow.

## Project Links

- Production app: https://agentremit-gamma.vercel.app
- Repository: https://github.com/dmetagame/AgentRemit

## Submission Description

AgentRemit lets diaspora senders automate stablecoin remittances instead of manually checking rates and timing transfers. The sender configures a remittance agent with a target USDC/NGN rate. The agent registers an ENS identity, watches live exchange-rate data, requests a Uniswap quote when the target is reached, submits the execution through KeeperHub, and stores the resulting receipt on 0G Storage.

For the demo, the dashboard shows wallet connection, a live nonzero USDC/NGN rate, auto-generated agent ENS names, seeded 0G receipts, and a full live activity feed: rate hit, quote, KeeperHub job, receipt saved, and ENS stats updated.

## Why It Matters

Remittance senders often care about timing. A small rate movement can materially change the amount family members receive. AgentRemit turns that manual process into a transparent, inspectable agent: the user defines the rule, the agent waits, and every step is surfaced in the UI with receipts.

## Core Features

- Connect wallet with RainbowKit and Wagmi.
- Display live USDC/NGN rates from the rates API.
- Auto-generate agent ENS names from sender input.
- Register ENS subnames and store agent configuration in text records.
- Trigger immediately when the live rate reaches the configured target.
- Quote and prepare swaps through Uniswap.
- Submit execution requests through KeeperHub.
- Store remittance receipts on 0G Storage.
- Show seeded and live receipt history in the dashboard.

## Tech Stack

- Next.js 14, React, TypeScript, Tailwind CSS
- RainbowKit, Wagmi, Viem, Ethers
- ENSJS on Sepolia
- Uniswap v3 SDK and UniversalRouter calldata
- KeeperHub Direct Execution API
- 0G Storage Galileo testnet
- Vercel production deployment

## Demo Flow

1. Open the production dashboard.
2. Connect a wallet and confirm the shortened wallet address appears.
3. Confirm the rate tracker shows a live USDC/NGN value.
4. Fill the setup form with a recipient, amount, and target rate below the current rate.
5. Confirm the ENS name preview updates while typing.
6. Deploy the agent.
7. Watch the activity feed for rate hit, quote, KeeperHub execution, receipt storage, and ENS stats updates.
8. Open the receipts table to inspect 0G-backed remittance history.

## Production Notes

The deployed app is configured for Sepolia and production Vercel environment variables. Live KeeperHub execution requires the KeeperHub organization behind `KEEPERHUB_API_KEY` to have a configured wallet. Without that wallet, KeeperHub returns:

```text
No wallet configured for this organization. Create a wallet in Settings before executing transactions.
```

For a local end-to-end demo without spending KeeperHub wallet funds, run the app in mock KeeperHub mode.

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
