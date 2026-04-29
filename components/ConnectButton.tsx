"use client";

import { ConnectButton as RainbowConnectButton } from "@rainbow-me/rainbowkit";
import { useDisconnect } from "wagmi";

export function ConnectButton() {
  const { disconnect } = useDisconnect();

  return (
    <RainbowConnectButton.Custom>
      {({
        account,
        chain,
        mounted,
        openAccountModal,
        openChainModal,
        openConnectModal,
      }) => {
        const connected = mounted && account && chain;
        const label = account
          ? account.ensName ?? truncateAddress(account.address)
          : "Connect wallet";

        if (connected && chain.unsupported) {
          return (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="h-10 rounded-md border border-[#cf222e] bg-white px-4 text-sm font-semibold text-[#cf222e] shadow-sm transition hover:bg-[#fff1f1]"
                onClick={openChainModal}
              >
                Switch network
              </button>
              <button
                type="button"
                className="h-10 rounded-md border border-[#d0d7de] bg-white px-4 text-sm font-semibold text-[#57606a] shadow-sm transition hover:border-[#cf222e] hover:text-[#cf222e]"
                onClick={() => disconnect()}
              >
                Disconnect
              </button>
            </div>
          );
        }

        if (connected) {
          return (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="h-10 rounded-md border border-[#d0d7de] bg-white px-4 text-sm font-semibold text-[#24292f] shadow-sm transition hover:border-[#0969da] hover:text-[#0969da]"
                onClick={openAccountModal}
              >
                {label}
              </button>
              <button
                type="button"
                className="h-10 rounded-md border border-[#d0d7de] bg-white px-4 text-sm font-semibold text-[#57606a] shadow-sm transition hover:border-[#cf222e] hover:text-[#cf222e]"
                onClick={() => disconnect()}
              >
                Disconnect
              </button>
            </div>
          );
        }

        return (
          <button
            type="button"
            className="h-10 rounded-md border border-[#d0d7de] bg-white px-4 text-sm font-semibold text-[#24292f] shadow-sm transition hover:border-[#0969da] hover:text-[#0969da] disabled:cursor-not-allowed disabled:opacity-60"
            disabled={!mounted}
            onClick={openConnectModal}
          >
            {label}
          </button>
        );
      }}
    </RainbowConnectButton.Custom>
  );
}

function truncateAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}
