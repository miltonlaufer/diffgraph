import { memo, useMemo } from "react";

interface GroupNodeData {
  label: string;
  bgColor: string;
  textColor: string;
  selected: boolean;
  width: number;
  height: number;
}

const GroupNode = ({ data }: { data: GroupNodeData }) => {
  /******************* COMPUTED ***********************/
  const style = useMemo(
    () => ({
      width: data.width,
      height: data.height,
      background: `${data.bgColor}22`,
      border: data.selected ? "2px solid #38bdf8" : `2px solid ${data.bgColor}`,
      borderRadius: 10,
      padding: 0,
      position: "relative" as const,
    }),
    [data.bgColor, data.selected, data.width, data.height],
  );
  const headerStyle = useMemo(
    () => ({
      background: data.bgColor,
      color: data.textColor,
      padding: "4px 10px",
      borderRadius: "8px 8px 0 0",
      fontSize: 11,
      fontWeight: 600,
      letterSpacing: 0.3,
    }),
    [data.bgColor, data.textColor],
  );

  return (
    <div style={style}>
      <div style={headerStyle}>{data.label}</div>
    </div>
  );
};

export default memo(GroupNode);
