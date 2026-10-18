/** リアルタイム配信(SSE)につながっているか。つながっていなければ、読み直しの間隔で、代わりに更新する */
let connected = false;

export const setLiveConnected = (value: boolean): void => {
  connected = value;
};

export const isLiveConnected = (): boolean => connected;
