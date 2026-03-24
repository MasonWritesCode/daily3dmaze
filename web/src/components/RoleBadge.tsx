import { ROLE_ADMIN, ROLE_MODERATOR } from "../lib/api";

interface RoleBadgeProps {
  role: string | null | undefined;
  labels: {
    admin: string;
    moderator: string;
  };
}

export default function RoleBadge({ role, labels }: RoleBadgeProps) {
  if (role === ROLE_ADMIN) {
    return <span className="role-badge role-badge-admin">{labels.admin}</span>;
  }

  if (role === ROLE_MODERATOR) {
    return <span className="role-badge role-badge-moderator">{labels.moderator}</span>;
  }

  return null;
}
