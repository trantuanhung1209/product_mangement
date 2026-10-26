import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { ConfirmDialog } from "./ConfirmDialog";

function Harness({ onConfirm = () => {}, busy = false }: { onConfirm?: () => void; busy?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>open</button>
      <button>behind the dialog</button>
      {open && (
        <ConfirmDialog busy={busy} title="Xóa?" description="Không thể khôi phục." onCancel={() => setOpen(false)} onConfirm={onConfirm} />
      )}
    </>
  );
}

describe("ConfirmDialog", () => {
  it("opens on the safe choice, keeps Tab inside, and hands focus back when closed", async () => {
    render(<Harness />);
    const opener = screen.getByText("open");
    await userEvent.click(opener);

    expect(screen.getByRole("button", { name: "Hủy" })).toHaveFocus();
    expect(screen.getByRole("dialog")).toHaveAccessibleDescription("Không thể khôi phục.");
    await userEvent.tab();
    expect(screen.getByRole("button", { name: "Xác nhận" })).toHaveFocus();
    await userEvent.tab(); // wraps instead of reaching "behind the dialog"
    expect(screen.getByRole("button", { name: "Hủy" })).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(screen.getByRole("button", { name: "Xác nhận" })).toHaveFocus();

    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it("stops the page behind it from scrolling, and Lenis from hijacking the wheel inside it", async () => {
    document.documentElement.style.overflow = "";
    render(<Harness />);
    await userEvent.click(screen.getByText("open"));

    expect(document.documentElement.style.overflow).toBe("hidden");
    expect(screen.getByRole("dialog").parentElement).toHaveAttribute("data-lenis-prevent");

    await userEvent.keyboard("{Escape}");
    expect(document.documentElement.style.overflow).toBe("");
  });

  it("ignores Escape and disables both buttons while busy", async () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog busy title="t" description="d" onCancel={onCancel} onConfirm={() => {}} />);

    await userEvent.keyboard("{Escape}");
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Hủy" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Đang xử lý..." })).toBeDisabled();
  });

  it("confirms exactly once per click", async () => {
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);
    await userEvent.click(screen.getByText("open"));
    await userEvent.click(screen.getByRole("button", { name: "Xác nhận" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
