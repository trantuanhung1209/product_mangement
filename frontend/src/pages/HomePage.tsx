import { useCallback, useEffect, useState } from "react";

import { api } from "../api";

type ConnectionState = "loading" | "success" | "error";

export function HomePage() {
  const [connectionState, setConnectionState] = useState<ConnectionState>("loading");

  const checkConnection = useCallback(async () => {
    setConnectionState("loading");

    try {
      await api.get("/health");
      setConnectionState("success");
    } catch {
      setConnectionState("error");
    }
  }, []);

  useEffect(() => {
    void checkConnection();
  }, [checkConnection]);

  return (
    <main>
      <h1>Product Catalog</h1>
      <p>
        Trạng thái kết nối Backend: {connectionState === "loading" && "Đang kiểm tra..."}
        {connectionState === "success" && "Đã kết nối"}
        {connectionState === "error" && "Không thể kết nối"}
      </p>
      <button type="button" onClick={() => void checkConnection()} disabled={connectionState === "loading"}>
        Kiểm tra lại kết nối
      </button>
    </main>
  );
}
