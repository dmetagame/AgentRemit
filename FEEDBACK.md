# Uniswap Developer Platform — Builder Feedback

## What worked well
The Uniswap Trading API `/quote` flow is straightforward to model for an autonomous agent: AgentRemit sends chain IDs, token in/out, exact input amount, swapper, V3 protocol preference, and slippage, then stores the returned route/expected output metadata in the receipt. The v3 SDK and viem also worked well as a fallback once the contract addresses and ABI details were correct. The published deployment table was useful for correcting network-specific addresses.

## Pain points and friction
The agent still needs UniversalRouter calldata because execution is delegated to KeeperHub's contract-call endpoint. The API quote gives the route and quote metadata, but the project still had to prepare execution calldata separately for the KeeperHub path. UniversalRouter command encoding required piecing together command bytes, input ABI tuples, WETH wrapping, recipient behavior, and payer semantics manually. This was powerful but slower than expected for a straightforward ETH to USDC exact-input swap.

The original Quoter address used during implementation was invalid, and viem caught it before any transaction was broadcast.

## Bugs encountered
Invalid Quoter address blocked quoting.

Reproduction steps:
1. Configure Sepolia Quoter as `0xEd1f6473345F45b75833fd55D5ADbE1391c6f2d`.
2. Call `getSwapQuote("0.001")`.
3. viem rejects the call because the address is not a valid checksummed 20-byte address.

After replacing the Quoter, UniversalRouter, and factory addresses with the official Sepolia deployment addresses, the quote and live swap completed successfully.

## Documentation gaps
The main gap was an end-to-end Sepolia example that combines Trading API `/quote` metadata with server-side UniversalRouter calldata construction for a delegated executor. The API reference explains `/quote`, and the v3/UniversalRouter pieces are documented separately, but a complete exact-input ETH to USDC flow with API quote, WRAP_ETH, V3_SWAP_EXACT_IN, path encoding, deadline, slippage, and gas estimation would have reduced integration time.

## Feature requests
A typed helper or SDK endpoint that returns ready-to-send UniversalRouter calldata for a simple exact-input swap would make this much easier. It would be especially useful if it accepted chain ID, token in/out, fee tier, amount in, recipient, deadline, and slippage, then returned quote, minimum out, route, calldata, value, gas estimate, and a stable route summary suitable for receipts.

## Integration summary
Built AgentRemit: an autonomous remittance agent for the Lagos corridor that watches USDC/NGN rates and executes swaps when the rate hits a user-defined target. The worker now requests Uniswap Trading API `/quote` data when `UNISWAP_API_KEY` is configured, records quote source, route, slippage, expected output, minimum output, before/after quote snapshots, and execution status in the remittance receipt, and falls back to Uniswap v3 contract quoting for local demos. UniversalRouter calldata is still built for KeeperHub execution on Sepolia.

NOTE: This file must be committed to the repo root before submission for Uniswap prize eligibility.
