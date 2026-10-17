'use client';

import { useEffect, useState } from 'react';

export default function Page() {
  const [message, setMessage] = useState('読み込み中...');

  useEffect(() => {
    fetch('/api/hello')
      .then((response) => response.json())
      .then((data) => setMessage(`${data.message} / ${data.time}`));
  }, []);

  return (
    <main>
      <h1>file-seiri PoC</h1>
      <p>{message}</p>
      <a href="/about">aboutへ</a>
    </main>
  );
}
