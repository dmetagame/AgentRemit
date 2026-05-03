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
                className="agent-button agent-button-danger h-10 px-4 text-sm"
                onClick={openChainModal}
              >
                Switch network
              </button>
              <button
                type="button"
                className="agent-button agent-button-secondary h-10 px-4 text-sm"
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
                className="agent-button agent-button-secondary h-10 px-4 text-sm"
                onClick={openAccountModal}
              >
                {label}
              </button>
              <button
                type="button"
                className="agent-button agent-button-secondary h-10 px-4 text-sm"
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
            className="agent-button agent-button-secondary h-10 px-4 text-sm"
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
