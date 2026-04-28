# Uniswap Developer Platform — Builder Feedback

## What worked well
The v3 SDK and viem worked well together once the contract addresses and ABI details were correct. The Quoter flow was fast to integrate, and UniversalRouter execution on Sepolia confirmed successfully after building the calldata. The published deployment table was useful for correcting network-specific addresses.

## Pain points and friction
The original Quoter address used during implementation was invalid, and viem caught it before any transaction was broadcast. UniversalRouter command encoding required piecing together command bytes, input ABI tuples, WETH wrapping, recipient behavior, and payer semantics manually. This was powerful but slower than expected for a straightforward ETH to USDC exact-input swap.

## Bugs encountered
Invalid Quoter address blocked quoting.

Reproduction steps:
1. Configure Sepolia Quoter as `0xEd1f6473345F45b75833fd55D5ADbE1391c6f2d`.
2. Call `getSwapQuote("0.001")`.
3. viem rejects the call because the address is not a valid checksummed 20-byte address.

After replacing the Quoter, UniversalRouter, and factory addresses with the official Sepolia deployment addresses, the quote and live swap completed successfully.

## Documentation gaps
The main gap was an end-to-end Sepolia example for v3 Quoter plus UniversalRouter using viem. The pieces are documented separately, but a complete exact-input ETH to USDC flow with WRAP_ETH, V3_SWAP_EXACT_IN, path encoding, deadline, slippage, and gas estimation would have reduced integration time.

## Feature requests
A typed helper or SDK endpoint that returns ready-to-send UniversalRouter calldata for a simple exact-input swap would make this much easier. It would be especially useful if it accepted chain ID, token in/out, fee tier, amount in, recipient, deadline, and slippage, then returned quote, minimum out, route, calldata, value, and gas estimate.

## Integration summary
Built AgentRemit: an autonomous remittance agent for the Lagos corridor that watches NGN/USDC rates and executes swaps when the rate hits a user-defined target. Used Uniswap v3 Quoter for rate quotes and UniversalRouter for swap execution on Sepolia.

NOTE: This file must be committed to the repo root before submission for Uniswap prize eligibility.
