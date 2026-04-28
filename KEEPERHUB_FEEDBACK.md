# KeeperHub Builder Feedback

## 0G Storage Integration Note
Discovered that @0glabs/0g-ts-sdk@0.3.3 uses the old Flow submit(Submission) ABI, but Galileo testnet expects the newer wrapped shape: submit({ data, submitter }).
Fixed by manually constructing the on-chain Flow tx with the correct Galileo ABI and calculating storage fee from pricePerSector. All 3 seed receipts confirmed on Galileo with root hashes in scripts/seed-output.json.

## Integration context
AgentRemit: autonomous remittance agent routing Uniswap swaps through KeeperHub for guaranteed execution.

## UX and UI friction
The dashboard-side flow was straightforward to model once AgentRemit emitted Server-Sent Events, but the API flow needed a few assumptions about job response shape. The app currently normalizes both `jobId` and `id`, plus wrapped `data` or direct job objects, because the expected response envelope was not obvious from the integration path.

## Reproducible bugs
No confirmed KeeperHub runtime bugs were hit during implementation because the integration was wired and type-checked before submitting a live KeeperHub job.

Potential reproduction area to validate:
1. Build a raw UniversalRouter transaction with bigint fields serialized as decimal strings.
2. POST it to `/jobs` with `retry_attempts`, `priority`, `gas_optimization`, and metadata.
3. Confirm whether KeeperHub accepts decimal string values for `value`, `gas`, and similar transaction fields, or whether it expects hex quantities.

## Documentation gaps
The biggest gap was the exact jobs API contract. The implementation needed clearer documentation for:

1. The canonical jobs endpoint path and production base URL.
2. The required transaction object format, especially bigint values such as `value`, `gas`, and fee fields.
3. The exact POST `/jobs` response shape and whether the job identifier is `jobId`, `id`, or nested under `data`.
4. The exact status enum returned by GET `/jobs/{jobId}`.
5. Query syntax for metadata filters such as `metadata.agentEnsName`.

## Feature requests
A typed OpenAPI spec or TypeScript SDK for the jobs API would make this much faster and safer. The most useful helper would be a `createJob(transaction, options, metadata)` client that handles auth headers, bigint serialization, response normalization, and polling until terminal status.

It would also help to have a sandbox endpoint or dry-run mode that validates a transaction payload without scheduling execution.

## What worked really well
The API key model was easy to integrate. Using `X-API-Key` is simple for server-side Next.js routes and keeps credentials out of the browser. The execution-oriented API shape also maps cleanly to AgentRemit's event stream: submit job, poll status, emit `job_submitted`, `job_confirmed`, or error events.

NOTE: Feedback must be specific and actionable. This qualifies for KeeperHub's $250 builder feedback bounty on top of the main prize.
