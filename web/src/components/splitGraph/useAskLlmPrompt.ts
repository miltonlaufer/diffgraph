import { useCallback, useMemo } from "react";
import { buildCappedChatGptUrl } from "./helpers";
import {
  buildAskLlmPrompt,
  buildAskLlmUrlPrompt,
  copyTextToClipboard,
  type UseAskLlmPromptParams,
} from "./askLlmHelpers";

export const useAskLlmPrompt = (
  params: UseAskLlmPromptParams,
): {
  handleAskLlmForNode: (nodeId: string) => Promise<boolean>;
  handleAskLlmHrefForNode: (nodeId: string) => string;
} => {
  const buildPrompt = useMemo(() => buildAskLlmPrompt(params), [params]);
  const buildUrlPrompt = useMemo(() => buildAskLlmUrlPrompt(params), [params]);

  const handleAskLlmForNode = useCallback(
    async (nodeId: string): Promise<boolean> => {
      const prompt = buildPrompt(nodeId);
      return copyTextToClipboard(prompt);
    },
    [buildPrompt],
  );

  const handleAskLlmHrefForNode = useCallback(
    (nodeId: string): string => {
      const prompt = buildUrlPrompt(nodeId);
      return buildCappedChatGptUrl(prompt);
    },
    [buildUrlPrompt],
  );

  return { handleAskLlmForNode, handleAskLlmHrefForNode };
};
