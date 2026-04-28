"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getDefaultConfig, RainbowKitProvider } from "@rainbow-me/rainbowkit";
import { injectedWallet } from "@rainbow-me/rainbowkit/wallets";
import { useState, type ReactNode } from "react";
import { http } from "viem";
import { WagmiProvider as WagmiConfig } from "wagmi";
import { sepolia } from "wagmi/chains";

const walletConnectProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_ID;
const sepoliaRpcUrl = process.env.NEXT_PUBLIC_ALCHEMY_SEPOLIA_URL;

const config = getDefaultConfig({
  appName: "AgentRemit",
  projectId: walletConnectProjectId || "agentremit-dev",
  chains: [sepolia],
  wallets: walletConnectProjectId
    ? undefined
    : [
        {
          groupName: "Available wallets",
          wallets: [injectedWallet],
        },
      ],
  transports: {
    [sepolia.id]: sepoliaRpcUrl ? http(sepoliaRpcUrl) : http(),
  },
  ssr: true,
});

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <WagmiConfig config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider>{children}</RainbowKitProvider>
      </QueryClientProvider>
    </WagmiConfig>
  );
}
