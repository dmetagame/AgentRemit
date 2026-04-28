import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const [amountInEth, recipientAddress] = process.argv.slice(2);

if (!amountInEth || !recipientAddress) {
  throw new Error(
    "Usage: npx tsx scripts/execute-swap.ts <amountInEth> <recipientAddress>",
  );
}

async function main() {
  const { executeSwap, getSwapQuote } = await import("../lib/swap");

  const quote = await getSwapQuote(amountInEth);

  console.log(
    JSON.stringify(
      {
        step: "quote",
        amountInEth,
        recipientAddress,
        quote,
      },
      null,
      2,
    ),
  );

  const result = await executeSwap(amountInEth, recipientAddress);

  console.log(
    JSON.stringify(
      {
        step: "executed",
        result,
      },
      null,
      2,
    ),
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
