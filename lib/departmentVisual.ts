import { departmentGroups } from "./departments.ts";

export type DepartmentVisualFamily =
  | "academic"
  | "student"
  | "general"
  | "counseling"
  | "personnel"
  | "accounting"
  | "principal"
  | "custom";

const officeFamilies = {
  教務處: "academic",
  學務處: "student",
  總務處: "general",
  輔導處: "counseling",
} as const satisfies Record<(typeof departmentGroups)[number]["office"], DepartmentVisualFamily>;

const fixedDepartmentFamilies = new Map<string, DepartmentVisualFamily>(
  departmentGroups.flatMap(group => group.departments.map(department => [department, officeFamilies[group.office]] as const)),
);

fixedDepartmentFamilies.set("人事室", "personnel");
fixedDepartmentFamilies.set("會計室", "accounting");
fixedDepartmentFamilies.set("校長", "principal");

export function departmentVisualFamily(department: string): DepartmentVisualFamily {
  return fixedDepartmentFamilies.get(department) ?? "custom";
}
