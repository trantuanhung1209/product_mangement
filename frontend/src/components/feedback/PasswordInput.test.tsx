import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { PasswordInput } from "./PasswordInput";

function Harness({ error }: { error?: string }) {
  const [value, setValue] = useState("Secret1!");
  return <PasswordInput label="Mật khẩu" value={value} onChange={setValue} autoComplete="new-password" error={error} />;
}

describe("PasswordInput", () => {
  it("toggles the input type without changing the value", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByLabelText("Mật khẩu");
    expect(input).toHaveAttribute("type", "password");

    await user.click(screen.getByRole("button", { name: "Hiện mật khẩu" }));
    expect(input).toHaveAttribute("type", "text");
    expect(input).toHaveValue("Secret1!");
    expect(screen.getByRole("button", { name: "Ẩn mật khẩu" })).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "Ẩn mật khẩu" }));
    expect(input).toHaveAttribute("type", "password");
  });

  it("ties the error to the field", () => {
    render(<Harness error="Mật khẩu phải có ít nhất 1 chữ hoa." />);
    const input = screen.getByLabelText("Mật khẩu");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Mật khẩu phải có ít nhất 1 chữ hoa.");
  });
});
