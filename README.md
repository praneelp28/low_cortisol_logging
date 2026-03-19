# low_cortisol_logging
don't get framemogged by UNIX

goal: like if im an eng using kibana, Grafana, and Thanos/Prom at once looking at some logs it'd be cool to have a web extension or tool or java or localserver that pays attention to the timescale i want to look at and on-click propogates that timeview to the other open tabs with that updated view

so what you need to do (i am a resesrch eng intern @ cloudflare) is find our internal Grafana, Prometheus, and Kibana links and find an example we can test on. that's order of business one -- let's figure out what time format, where they live, schema, how to update them, then we'll design an architecture

this will probably look like either a private browser extention that lets a user open it up, click on it to open up a tiny UI that lets them click like "propogate timestamp" and whatever tab is currently open out of our G,K,P tabs are open in that window it'll propogate timestamp through all of them. \