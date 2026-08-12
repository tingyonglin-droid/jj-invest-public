import React from "react";

export function OverviewCardHeader({
  action = null,
  infoLabel,
  onInfo,
  subtitle = "",
  title,
}) {
  const actionWithSharedStyle = action
    ? React.cloneElement(action, {
        className: ["overviewCardAction", action.props.className].filter(Boolean).join(" "),
      })
    : null;

  return React.createElement(
    "header",
    { className: "overviewCardHeader" },
    React.createElement(
      "div",
      { className: "overviewCardHeaderText" },
      React.createElement(
        "div",
        { className: "overviewCardHeaderTitle" },
        React.createElement("h2", null, title),
        React.createElement(
          "button",
          {
            type: "button",
            className: "infoButton overviewCardInfoButton",
            onClick: onInfo,
            "aria-label": infoLabel,
          },
          "i",
        ),
      ),
      subtitle
        ? React.createElement("p", { className: "overviewCardSubtitle" }, subtitle)
        : null,
    ),
    actionWithSharedStyle
      ? React.createElement(
          "div",
          { className: "overviewCardHeaderAction" },
          actionWithSharedStyle,
        )
      : null,
  );
}
