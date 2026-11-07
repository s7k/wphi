// 看板の送る行(Philly の MEditForm.cpp の SendExecute)。

/** 空行は空白1つにし、最後に . だけの行を足す */
export function boardText(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  return [...lines.map((l) => (l === "" ? " " : l)), "."].join("\n");
}

