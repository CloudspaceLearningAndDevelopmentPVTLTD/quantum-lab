# Minimal image for the email-dispatch cron job (infra/azure/deploy-email-cron.sh).
#
# WHY A CUSTOM IMAGE INSTEAD OF `curlimages/curl` PLUS `--command`/`--args`:
# `az containerapp job create --command "/bin/sh" --args "-c" "<script>"`
# failed with "unrecognized arguments" for a script containing curl's `-H`
# header quoting and a `%{...}` write-out format — none of `az containerapp
# job create --help`'s own examples override command/args this way either.
# Baking the one command this job ever runs into the image's ENTRYPOINT
# sidesteps CLI argument quoting entirely: the job then needs nothing but
# `--image` and two `--env-vars`, both plain `KEY=value`/`KEY=secretref:...`
# tokens with no embedded spaces or quotes to mis-parse.
FROM alpine:3.20
RUN apk add --no-cache curl
COPY dispatch.sh /dispatch.sh
RUN chmod +x /dispatch.sh
ENTRYPOINT ["/dispatch.sh"]
