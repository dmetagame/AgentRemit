# AI Usage Disclosure

AgentRemit was built with human direction and AI-assisted implementation support from Codex.

## How AI Was Used

- Planning the end-to-end architecture for the agent workflow.
- Implementing and refining Next.js UI components, API routes, and TypeScript types.
- Debugging production issues found during browser and API audits.
- Drafting project documentation and submission copy.
- Producing concise test plans for wallet connection, rates, ENS generation, receipts, and agent execution.

## Areas Touched With AI Assistance

- Dashboard and UI: `app/page.tsx`, `components/SetupForm.tsx`, `components/RateTracker.tsx`, `components/ActivityFeed.tsx`, `components/ReceiptsTable.tsx`, `components/ConnectButton.tsx`
- Agent runtime: `lib/agent.ts`, `app/api/agent/route.ts`
- ENS integration: `lib/ens.ts`, `app/api/ens/route.ts`
- Rate tracking: `lib/rates.ts`, `app/api/rates/route.ts`
- Swap and execution flow: `lib/swap.ts`, `lib/payments.ts`
- 0G Storage receipts: `lib/storage.ts`, `app/api/receipts/route.ts`, `scripts/seed*.ts`
- Documentation: `README.md`, `FEEDBACK.md`, `KEEPERHUB_FEEDBACK.md`, `AI_USAGE.md`

## Human Oversight

The project owner directed the product requirements, reviewed production behavior, configured the deployment environment, and approved the major implementation and deployment steps. Final behavior was checked with local builds, direct API calls, and browser-based production audits.

## Generated Assets

No AI-generated voiceover, video, or visual assets are included in the repository. The UI is implemented with code-native React and Tailwind components.

## Known Production Dependency

Live KeeperHub execution depends on the configured KeeperHub organization having an execution wallet. If no KeeperHub wallet is configured, the app reaches the KeeperHub step and surfaces the provider error instead of completing the receipt flow.
