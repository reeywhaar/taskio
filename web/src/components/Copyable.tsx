import { useState } from "react";

import { copy } from "@app/clipboard";
import { Button } from "@app/components/Button";

/**
 * Something shown once, with a button that copies it.
 *
 * A button, not only a selectable line: dragging across forty-odd characters of base64 is where
 * a secret gets copied one character short. It says so afterwards, because a copy that reports
 * nothing is a copy nobody trusts.
 */
export function Copyable({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const press = async () => {
    if (!(await copy(value))) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div className="flex items-start gap-2">
      <code className="sunken block min-w-0 flex-1 rounded-md bg-bg px-3 py-2 font-mono text-sm break-all select-all">
        {value}
      </code>
      <Button onClick={() => void press()}>{copied ? "Copied" : "Copy"}</Button>
    </div>
  );
}
