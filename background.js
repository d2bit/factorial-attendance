chrome.runtime.onInstalled.addListener(function() {
  chrome.declarativeContent.onPageChanged.removeRules(undefined, function() {
    chrome.declarativeContent.onPageChanged.addRules([
      {
        conditions: [
          new chrome.declarativeContent.PageStateMatcher({
            pageUrl: {
              urlContains: "https://app.factorialhr.com/attendance/clock-in"
            }
          })
        ],
        actions: [new chrome.declarativeContent.ShowPageAction()]
      }
    ]);
  });
  chrome.webRequest.onBeforeSendHeaders.addListener(
    function(details) {
      for (let i = 0; i < details.requestHeaders.length; ++i) {
        if (details.requestHeaders[i].name === "Origin")
          details.requestHeaders[i].value = "https://app.factorialhr.com";
      }

      return { requestHeaders: details.requestHeaders };
    },
    {
      urls: ["*://app.factorialhr.com/*"]
    },
    ["requestHeaders", "extraHeaders"]
  );
});
