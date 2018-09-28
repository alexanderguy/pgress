var pg = new PGConn("ws://localhost:8080/");

var startFirstQuery = function (e) {
    pg.removeEventListener("readyforquery", startFirstQuery);

    pg.query("select now();")
      .then(function (res) {
      })
      .catch(function (err) {
      });
}

pg.addEventListener("readyforquery", startFirstQuery);

pg.connect("alexander", "mypasswd");
