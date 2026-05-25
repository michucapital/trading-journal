#region Using declarations
using System;
using System.ComponentModel;
using System.ComponentModel.DataAnnotations;
using System.Globalization;
using System.Linq;
using System.Net.Http;
using System.Text;
using System.Threading.Tasks;
using NinjaTrader.Cbi;
using NinjaTrader.NinjaScript;
using NinjaTrader.NinjaScript.AddOns;
#endregion

namespace NinjaTrader.NinjaScript.AddOns
{
    public class JournalExporter : NinjaTrader.NinjaScript.AddOnBase
    {
        private static JournalExporter _instance;
        private Account targetAccount;

        // Static HttpClient — AllowAutoRedirect = false prevents POST→GET downgrade on redirects
        private static readonly HttpClient httpClient = new HttpClient(
            new HttpClientHandler { AllowAutoRedirect = false }
        );

        // Deduplication: skip duplicate ExecutionUpdate events for the same fill
        private string lastExecutionId = string.Empty;

        // ---------------------------------------------------------------
        // CONFIGURABLE SETTINGS — set these in NT8 Tools > Options > AddOns
        // They are stored locally by NT8 and never committed to GitHub.
        // ---------------------------------------------------------------
        [NinjaScriptProperty]
        [Display(Name = "API URL", Description = "Your Vercel deployment URL, e.g. https://trading-journal-zeta-dun.vercel.app/api/trade", Order = 1, GroupName = "Journal Settings")]
        public string ApiUrl { get; set; }

        [NinjaScriptProperty]
        [Display(Name = "API Secret", Description = "Must match API_SECRET_TOKEN in your Vercel environment variables", Order = 2, GroupName = "Journal Settings")]
        public string ApiSecret { get; set; }

        [NinjaScriptProperty]
        [Display(Name = "Account Name", Description = "Exact NT8 account name to monitor, e.g. DEMO4560079", Order = 3, GroupName = "Journal Settings")]
        public string AccountName { get; set; }

        public JournalExporter()
        {
            // Safe defaults — no secrets, no localhost assumption
            ApiUrl      = "https://your-vercel-url.vercel.app/api/trade";
            ApiSecret   = "";
            AccountName = "";
        }

        public static JournalExporter Instance
        {
            get
            {
                if (_instance == null)
                {
                    _instance = new JournalExporter();
                    _instance.Initialize();
                }
                return _instance;
            }
        }

        private void Initialize()
        {
            if (string.IsNullOrWhiteSpace(AccountName) || string.IsNullOrWhiteSpace(ApiSecret))
            {
                NinjaTrader.Code.Output.Process(
                    "JournalExporter: Not configured. Go to Tools > Options > AddOns and set Account Name, API URL, and API Secret.",
                    PrintTo.OutputTab1
                );
                return;
            }

            lock (Account.All)
            {
                targetAccount = Account.All.FirstOrDefault(a => a.Name == AccountName);
            }

            if (targetAccount != null)
            {
                targetAccount.ExecutionUpdate += OnExecutionUpdate;
                NinjaTrader.Code.Output.Process("JournalExporter connected: " + targetAccount.Name, PrintTo.OutputTab1);
            }
            else
            {
                NinjaTrader.Code.Output.Process(
                    "JournalExporter: Account '" + AccountName + "' not found. " +
                    "Ensure NT8 is connected to your data feed before the AddOn loads.",
                    PrintTo.OutputTab1
                );
            }
        }

        private void OnExecutionUpdate(object sender, ExecutionEventArgs e)
        {
            if (e.Operation != Operation.Add)
                return;

            string executionId = e.Execution.ExecutionId;
            if (executionId == lastExecutionId)
                return;
            lastExecutionId = executionId;

            string orderId       = e.Execution.OrderId;
            string instrument    = e.Execution.Instrument.MasterInstrument.Name;
            string action        = e.Execution.MarketPosition == MarketPosition.Long ? "Buy" : "Sell";
            int    quantity      = e.Quantity;
            double price         = e.Price;
            int    positionAfter = e.Execution.Position;
            DateTime time        = e.Time;

            int previousPosition = action == "Buy" ? positionAfter - quantity : positionAfter + quantity;
            string marker = Math.Abs(positionAfter) < Math.Abs(previousPosition) ? "Exit" : "Entry";

            // InvariantCulture: guarantees dot decimal separator regardless of Windows locale
            string priceStr = price.ToString("F4", CultureInfo.InvariantCulture);

            string jsonPayload = string.Format(
                CultureInfo.InvariantCulture,
                @"{{""executionId"":""{0}"",""orderId"":""{1}"",""instrument"":""{2}"",""action"":""{3}"",""quantity"":{4},""price"":{5},""marker"":""{6}"",""position"":{7},""timestamp"":""{8}""}}",
                executionId,
                orderId,
                instrument,
                action,
                quantity,
                priceStr,
                marker,
                positionAfter,
                time.ToString("o", CultureInfo.InvariantCulture)
            );

            NinjaTrader.Code.Output.Process("Sending " + marker + " [" + instrument + " @ " + priceStr + "]...", PrintTo.OutputTab1);

            Task.Run(async () => await SendDataToServer(jsonPayload));
        }

        private async Task SendDataToServer(string jsonPayload)
        {
            try
            {
                var request = new HttpRequestMessage(HttpMethod.Post, ApiUrl)
                {
                    Content = new StringContent(jsonPayload, Encoding.UTF8, "application/json")
                };
                request.Headers.Authorization =
                    new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", ApiSecret);

                var response = await httpClient.SendAsync(request);

                if (response.IsSuccessStatusCode)
                {
                    NinjaTrader.Code.Output.Process("=> Saved.", PrintTo.OutputTab1);
                }
                else
                {
                    string body = await response.Content.ReadAsStringAsync();
                    NinjaTrader.Code.Output.Process("=> Error (" + response.StatusCode + "): " + body, PrintTo.OutputTab1);
                }
            }
            catch (Exception ex)
            {
                NinjaTrader.Code.Output.Process("=> HTTP Failed: " + ex.Message, PrintTo.OutputTab1);
            }
        }

        protected override void OnStateChange()
        {
            if (State == State.Terminated)
            {
                if (targetAccount != null)
                {
                    targetAccount.ExecutionUpdate -= OnExecutionUpdate;
                    targetAccount = null;
                }
            }
        }
    }

    public class JournalExporterBootstrapper : NinjaTrader.NinjaScript.AddOnBase
    {
        protected override void OnStateChange()
        {
            if (State == State.Active)
            {
                var _ = JournalExporter.Instance;
            }
        }
    }
}
