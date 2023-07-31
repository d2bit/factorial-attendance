document.addEventListener("DOMContentLoaded", function() {
  loadShiftInfo();
  const form = document.querySelector("form");
  form.addEventListener("change", function(event) {
    persistShiftInfo();
  });
  let done = false;
  form.addEventListener("submit", function(event) {
    event.preventDefault();
    if (!done) {
      form.style.opacity = 0.4;
      updateFactorialShifts();
      done = true;
    }
  });
});

function loadShiftInfo() {
  const DEFAULT = [["08:00", "13:00"], ["15:00", "18:00"]];
  let shiftInfo;
  try {
    const json = window.localStorage.getItem("shiftInfo");
    shiftInfo = JSON.parse(json) || DEFAULT;
  } catch {
    shiftInfo = DEFAULT;
  }

  const shiftInputs = document.querySelector(".shifts");
  shiftInfo.forEach(([from, to]) => {
    shiftInputs.append(createShiftInput(from, to));
  });
}
function createShiftInput(from, to) {
  const shift = document.createElement("div");
  shift.classList.add("shift");
  const fromInput = document.createElement("input");
  fromInput.type = "time";
  fromInput.dataset["from"] = true;
  fromInput.value = from;
  const toInput = document.createElement("input");
  toInput.dataset["to"] = true;
  toInput.type = "time";
  toInput.value = to;
  const separator = document.createElement("span");
  separator.classList.add("separator");
  separator.append("-");
  shift.append(fromInput, separator, toInput);
  return shift;
}

function readShiftInfo() {
  const shiftInputs = Array.from(document.querySelectorAll(".shift"));
  let shiftInfo = [];
  shiftInputs.forEach(shiftNode => {
    shiftInfo.push([
      shiftNode.querySelector("[data-from]").value,
      shiftNode.querySelector("[data-to]").value
    ]);
  });

  return shiftInfo;
}

function persistShiftInfo() {
  const shiftInfo = readShiftInfo();
  try {
    const json = JSON.stringify(shiftInfo);
    window.localStorage.setItem("shiftInfo", json);
    return true;
  } catch {}
  return false;
}

// FACTORIAL STUFF

function request(url, config = { method: "GET", body: null, referrer: null }) {
  const { method, body, referrer } = config;
  return fetch(url, {
    credentials: "include",
    headers: {
      accept: "application/json, text/plain, */*",
      "accept-language": "en-US,en;q=0.9,ca;q=0.8,es;q=0.7",
      "cache-control": "no-cache",
      "content-type": "application/json;charset=UTF-8",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-site"
    },
    referrer,
    referrerPolicy: "no-referrer-when-downgrade",
    body,
    method,
    mode: "cors"
  });
}
function isFutureDate(dateStr) {
  const date = new Date(dateStr);
  const now = new Date();
  return date > now;
}

function updateFactorialShifts() {
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    const url = tabs[0].url;
    const [year, month] = url.split("/").slice(5);
    const shifts = readShiftInfo();

    request(
      `https://api.factorialhr.com/attendance/periods?year=${year}&month=${month}`,
      { referrer: url }
    )
      .then(r => r.json())
      .then(periods => {
        periods.forEach(
          ({ id: periodId, employee_id: employeeId, state, distribution }) => {
            if (!['pending', 'in_progress'].includes(state)) return;

            let change = 0;
            request(
              `https://api.factorialhr.com/attendance/calendar?id=${employeeId}&year=${year}&month=${month}`,
              { referrer: url }
            )
              .then(r => r.json())
              .then(async days => {
                await Promise.all(
                  days.map(async day => {
                    const alreadyFilled = distribution[day.day - 1] > 0;

                    if (alreadyFilled) {
                      console.log(`Skipping ${day.date}, already filled`);
                      return;
                    }

                    if (!day.is_laborable) {
                      console.log(`Skipping ${day.date}, not laborable`);
                      return;
                    }

                    if (day.is_leave) {
                      console.log(`Skipping ${day.date}, is leave`);
                      return;
                    }

                    if (isFutureDate(day.date)) {
                      console.log(`Skipping ${day.date}, is future date`);
                      return;
                    }

                    console.log(`Updating ${day.date}`);

                    change += 1;
                    return await Promise.all(
                      shifts.map(([clockIn, clockOut]) => {
                        const body = {
                          clock_in: clockIn,
                          clock_out: clockOut,
                          day: day.day,
                          period_id: periodId
                        };
                        return request(
                          "https://api.factorialhr.com/attendance/shifts",
                          {
                            method: "POST",
                            body: JSON.stringify(body),
                            referrer: url
                          }
                        ).catch((error) => {
                          console.log(`Updating ${day.date} failed`, error)
                        });;
                      })
                    );
                  })
                );
                if (change > 0) {
                  chrome.tabs.reload(tabs[0].id);
                } else {
                  console.log("No changes");
                }

                // window.close();
              })
              .catch((error) => {
                console.log(error);
              });
          }
        );
      })
      .catch((error) => {
        console.log(error);
      });
  });
}
