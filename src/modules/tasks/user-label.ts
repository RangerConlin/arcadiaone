type Labelled = { email: string; employee?: { firstName: string; preferredName: string | null; lastName: string } | null };

export function userLabel(user: Labelled) {
  return user.employee ? `${user.employee.preferredName || user.employee.firstName} ${user.employee.lastName}` : user.email;
}
