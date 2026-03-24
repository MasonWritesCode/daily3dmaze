import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import RoleBadge from "./RoleBadge";

describe("RoleBadge", () => {
  it("renders an admin badge for admins", () => {
    render(<RoleBadge role="admin" labels={{ admin: "Admin", moderator: "Moderator" }} />);

    expect(screen.getByText("Admin")).toBeInTheDocument();
  });

  it("renders a moderator badge for moderators", () => {
    render(<RoleBadge role="moderator" labels={{ admin: "Admin", moderator: "Moderator" }} />);

    expect(screen.getByText("Moderator")).toBeInTheDocument();
  });

  it("renders nothing for regular users", () => {
    const { container } = render(
      <RoleBadge role="user" labels={{ admin: "Admin", moderator: "Moderator" }} />
    );

    expect(container).toBeEmptyDOMElement();
  });
});
