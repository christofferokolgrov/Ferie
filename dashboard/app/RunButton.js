'use client';

import { useState, useTransition } from 'react';
import { triggerSweep } from './actions';

export default function RunButton() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState(null);

  function run() {
    setResult(null);
    startTransition(async () => {
      setResult(await triggerSweep());
    });
  }

  return (
    <div className="runbox">
      <button className="run" onClick={run} disabled={pending}>
        {pending ? 'Starting…' : '↻ Run screening now'}
      </button>
      {result && (
        <span className={result.ok ? 'run-ok' : 'run-err'}>{result.message}</span>
      )}
    </div>
  );
}
