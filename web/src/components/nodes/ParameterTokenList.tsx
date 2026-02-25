import { memo, useMemo } from "react";
import type { FunctionParameterDiffEntry } from "../../types/graph";

const parameterTextColors: Record<FunctionParameterDiffEntry["status"], string> = {
  removed: "#dc2626",
  modified: "#ca8a04",
  added: "#15803d",
  unchanged: "#111111",
};

const tokenStyleBase = { fontWeight: 600 } as const;

interface ParameterTokenListProps {
  tokens: FunctionParameterDiffEntry[];
}

export const ParameterTokenList = memo(({ tokens }: ParameterTokenListProps) => (
  <>
    {tokens.map((token, index) => (
      <ParameterToken key={`${token.status}:${token.text}:${index}`} token={token} showSeparator={index < tokens.length - 1} />
    ))}
  </>
));

ParameterTokenList.displayName = "ParameterTokenList";

interface ParameterTokenProps {
  token: FunctionParameterDiffEntry;
  showSeparator: boolean;
}

const ParameterToken = memo(({ token, showSeparator }: ParameterTokenProps) => {
  const spanStyle = useMemo(
    () => ({ ...tokenStyleBase, color: parameterTextColors[token.status] }),
    [token.status],
  );
  return (
    <span>
      <span style={spanStyle}>{token.text}</span>
      {showSeparator && <span>, </span>}
    </span>
  );
});

ParameterToken.displayName = "ParameterToken";
