import { createSignal, onMount, For } from "solid-js";
import './App.css'

const SHIFT_INFO_KEY = "shift_info"
const SHIFT_INFO_DEFAULT = [["08:00", "13:00"], ["15:00", "18:00"]]
const RANDOM_BY_KEY = "random_by"
const RANDOM_BY_DEFAULT = 0
function App() {
  const [loading, setLoading] = createSignal(true)
  const [shifts, setShifts] = createSignal([])
  const [randomBy, setRandomBy] = createSignal(0)
  const [futureEnabled, setFutureEnabled] = createSignal(false)

  onMount(async () => {
    let storage = await chrome.storage.local.get();

    let storedShiftInfo = storage[SHIFT_INFO_KEY] || SHIFT_INFO_DEFAULT
    setShifts(storedShiftInfo)
    let storedRandomBy = storage[RANDOM_BY_KEY] || RANDOM_BY_DEFAULT
    setRandomBy(storedRandomBy)
    setLoading(false)
  })

  return (
    <>
      <h1 class="title">factorial attendance</h1>
      <div class="shifts">
        <For each={shifts()}>{(shift, i) =>
          <div>
            <input type="time" data-from value={shift[0]} onChange={(e) => handleShiftChange(i(), 0, e.target.value)}></input>
            &nbsp;-&nbsp
            <input type="time" data-from value={shift[1]} onChange={(e) => handleShiftChange(i(), 1, e.target.value)}></input>
          </div>
        }</For>
      </div>
      <div>
        <span>Randomize time (in minutes)</span>
        <input type="number" value={randomBy()} onChange={handleRandomBy}></input>
      </div>
      <div>
        <span>Enable future filling</span>
        <input type="checkbox" checked={futureEnabled()} onChange={handleFuture}></input>
      </div>
      <button class="btn" onClick={handleBtn}>Fill shifts!</button>
    </>
  )

  function handleFuture(e) {
    setFutureEnabled(e.target.checked)
  }

  function handleRandomBy(e) {
    let val = parseInt(e.target.value)
    if (val < 0) { val = -val }
    setRandomBy(val)
    chrome.storage.local.set({[RANDOM_BY_KEY]: val});
  }

  function handleShiftChange(p1, p2, value) {
    let copy = [...shifts()]
    copy[p1][p2] = value
    setShifts(copy)
    chrome.storage.local.set({[SHIFT_INFO_KEY]: copy});
  }

  function handleBtn(e) {
    let shiftsIterator = randomizedShiftsIterator(shifts(), randomBy())
    updateFactorialShifts(shiftsIterator, futureEnabled())
  }
}

function strToMin(timeStr) {
  const [hour, minute] = timeStr.split(":")
  return parseInt(hour)*60 + parseInt(minute)
}

function minToStr(timeInMin) {
  let minute = (timeInMin % 60).toString()
  if (minute.length < 2) { minute = "0" + minute }
  let hour = ((timeInMin-minute) / 60).toString()
  if (hour.length < 2) { hour = "0" + hour }
  return `${hour}:${minute}`
}

function randomizedShiftsIterator(shifts, randomBy) {
  return {
    next() {
      if (randomBy === 0) {
        return shifts
      }

      let diffTimes = [0, 0, 0].map(() => Math.floor(Math.random() * 2 * randomBy) - randomBy)
      diffTimes.push(diffTimes[0]-diffTimes[1]+diffTimes[2])

      return [
        [
          minToStr(strToMin(shifts[0][0])+diffTimes[0]),
          minToStr(strToMin(shifts[0][1])+diffTimes[1])
        ],
        [
          minToStr(strToMin(shifts[1][0])+diffTimes[2]),
          minToStr(strToMin(shifts[1][1])+diffTimes[3])
        ]
      ]
    }
  }
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

function updateFactorialShifts(shiftsIterator, fillFuture=false) {
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    const url = tabs[0].url;
    const [year, month] = url.split("/").slice(5);

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

                    if (isFutureDate(day.date) && !fillFuture) {
                      console.log(`Skipping ${day.date}, is future date`);
                      return;
                    }

                    console.log(`Updating ${day.date}`);

                    change += 1;
                    let shifts = shiftsIterator.next()
                    console.log("Shifts:", JSON.stringify(shifts))
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

export default App
