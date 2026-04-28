import "dotenv/config";

export async function deploy() {
  const privateKey = process.env.PRIVATE_KEY;
  const rpcUrl = process.env.NEXT_PUBLIC_ALCHEMY_SEPOLIA_URL;

  if (!privateKey) {
    throw new Error("PRIVATE_KEY is required to deploy.");
  }

  if (!rpcUrl) {
    throw new Error("NEXT_PUBLIC_ALCHEMY_SEPOLIA_URL is required to deploy.");
  }

  return {
    network: "sepolia",
    rpcUrl,
    ready: true,
  };
}

if (require.main === module) {
  deploy()
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exit(1);
    });
}
