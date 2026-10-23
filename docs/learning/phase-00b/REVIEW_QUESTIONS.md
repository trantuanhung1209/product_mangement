# Câu hỏi tự kiểm tra

1. Vì sao `add_middleware(B)` rồi `add_middleware(A)` lại cho A chạy trước? Hãy đối chiếu `build_middleware_stack()`.
2. Vì sao 404 có `X-Process-Time-Ms` nhưng RuntimeError 500 mặc định không có?
3. Tại sao `TestClient` mặc định re-raise RuntimeError, và khi nào nên dùng `raise_server_exceptions=False`?
4. Malformed JSON khác invalid field ở đâu? Cả hai vì sao đều không chạy endpoint?
5. `asyncio.sleep(2)` có ý nghĩa gì khác `time.sleep(2)` trong server async?
6. Đo ở TimingMiddleware thiếu những phần nào so với latency browser thấy?
7. Nếu thêm authentication middleware ngoài A, request ID và error behavior có thể đổi ra sao?
8. Để production hóa telemetry này, bạn sẽ đưa logging configuration và request-ID propagation vào đâu?
