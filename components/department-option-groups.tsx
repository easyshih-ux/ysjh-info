import { OTHER_DEPARTMENT_OPTION, departmentGroups, isFixedDepartment, standaloneDepartments } from "@/lib/departments";

interface DepartmentOptionGroupsProps {
  includeOther?: boolean;
  currentDepartment?: string;
}

export function DepartmentOptionGroups({ includeOther = false, currentDepartment }: DepartmentOptionGroupsProps) {
  const customCurrentDepartment = currentDepartment
    && !isFixedDepartment(currentDepartment)
    && currentDepartment !== OTHER_DEPARTMENT_OPTION
    ? currentDepartment
    : null;

  return <>
    <optgroup label="校級／獨立單位">
      {standaloneDepartments.map(department => <option key={department} value={department}>{department}</option>)}
    </optgroup>
    {departmentGroups.map(group => <optgroup key={group.office} label={group.office}>
      {group.departments.map(department => <option key={department} value={department}>{department}</option>)}
    </optgroup>)}
    {customCurrentDepartment && <optgroup label="目前發布單位"><option value={customCurrentDepartment}>{customCurrentDepartment}</option></optgroup>}
    {includeOther && <optgroup label="其他"><option value={OTHER_DEPARTMENT_OPTION}>{OTHER_DEPARTMENT_OPTION}</option></optgroup>}
  </>;
}
