import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { ToastProvider, useToast } from "./Toast";

function Trigger() {
  const { showToast } = useToast();
  return (
    <>
      <button onClick={() => showToast("Đã lưu.")}>ok</button>
      <button onClick={() => showToast("Không thể lưu.", "error")}>fail</button>
    </>
  );
}

describe("Toast", () => {
  it("announces success politely and errors assertively", async () => {
    render(<ToastProvider><Trigger /></ToastProvider>);

    await userEvent.click(screen.getByText("ok"));
    expect(screen.getByRole("status")).toHaveTextContent("Đã lưu.");
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");

    await userEvent.click(screen.getByText("fail"));
    expect(screen.getByRole("alert")).toHaveTextContent("Không thể lưu.");
    expect(screen.getByRole("alert")).toHaveAttribute("aria-live", "assertive");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("can be dismissed", async () => {
    render(<ToastProvider><Trigger /></ToastProvider>);
    await userEvent.click(screen.getByText("ok"));
    await userEvent.click(screen.getByRole("button", { name: "Đóng thông báo" }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    await act(async () => {});
  });
});
