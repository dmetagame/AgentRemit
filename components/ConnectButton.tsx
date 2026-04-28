"use client";

import { ConnectButton as RainbowConnectButton } from "@rainbow-me/rainbowkit";

export function ConnectButton() {
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
            <button
              type="button"
              className="h-10 rounded-md border border-[#cf222e] bg-white px-4 text-sm font-semibold text-[#cf222e] shadow-sm transition hover:bg-[#fff1f1]"
              onClick={openChainModal}
            >
              Switch network
            </button>
          );
        }

        return (
          <button
            type="button"
            className="h-10 rounded-md border border-[#d0d7de] bg-white px-4 text-sm font-semibold text-[#24292f] shadow-sm transition hover:border-[#0969da] hover:text-[#0969da] disabled:cursor-not-allowed disabled:opacity-60"
            disabled={!mounted}
            onClick={connected ? openAccountModal : openConnectModal}
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
